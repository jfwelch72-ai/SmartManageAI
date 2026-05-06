// AUTO-GENERATED SPLIT FROM shared/schema/features.ts (Task #2426).
// Domain bucketing rule lives in shared/schema/features/index.ts.
import { sql } from "drizzle-orm";
import { pgTable, text, varchar, boolean, timestamp, date, decimal, integer, pgEnum, doublePrecision, index, unique, uniqueIndex, json, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod";
import { addendumRecipientTypeEnum, addendumStatusEnum, aiBidDocumentAnalysisStatusEnum, aiCoDraftStatusEnum, aiContractDocumentAnalysisStatusEnum, contractStatusEnum, contractTypeEnum, contractRedlineStatusEnum, contractApprovalDecisionEnum, clauseCategoryEnum, signatureRequestStatusEnum, signerStatusEnum, aiInsightModuleEnum, aiInsightSeverityEnum, aiTakeoffModeEnum, aiTakeoffStatusEnum, aiTakeoffSuggestionStatusEnum, aiTakeoffRejectReasonEnum, aiTaskPriorityEnum, aiTaskStatusEnum, approvalEntityTypeEnum, approvalStatusEnum, atsProviderEnum, bidEquipmentSourceEnum, bidInvitationStatusEnum, bidRequestStatusEnum, bidResponseStatusEnum, blogCommentStatusEnum, blogPostStatusEnum, conversationTypeEnum, crewAvailabilityStatusEnum, crmActivityTypeEnum, crmCallDirectionEnum, crmCallOutcomeEnum, crmCallStatusEnum, crmCustomFieldEntityEnum, crmCustomFieldTypeEnum, crmContactRoleEnum, crmNoteTypeEnum, crmOrgStatusEnum, crmOrganisationTypeEnum, crmPipelineStageEnum, crmPreferredContactEnum, crmLostCategoryEnum, crmQuoteAcceptanceStatusEnum, crmLeadScoringOperatorEnum, crmSequenceStatusEnum, crmSequenceStepTypeEnum, crmSequenceEnrollmentStatusEnum, crmSequenceExecutionStatusEnum, crmSequenceEmailEventTypeEnum, crmSequenceExitReasonEnum, crmQuoteApprovalStatusEnum, dataSubjectRequestStatusEnum, dataSubjectRequestTypeEnum, documentRevisionSourceEnum, documentRevisionStatusEnum, emailClassificationEnum, emailProviderEnum, emailTaskSourceEnum, emailThreadStatusEnum, hiringActivityTypeEnum, hiringCandidateStageEnum, hiringCompensationTypeEnum, hiringEmploymentTypeEnum, hiringInterviewStatusEnum, hiringJobStatusEnum, hiringSyncStatusEnum, hustlerDelegateRoleEnum, hustlerLinkRequestStatusEnum, installationStatusEnum, lidarScanStatusEnum, lidarAnnotationTypeEnum, lidarComparisonTypeEnum, unifiedPaymentMethodEnum, unifiedPaymentStatusEnum, invoiceTypeEnum, integrationConnectionStatusEnum, integrationEventStatusEnum, integrationProviderEnum, issueSeverityEnum, issueStatusEnum, jobsiteAnalysisStatusEnum, lienWaiverStatusEnum, lienWaiverTypeEnum, locationLevelEnum, maintenanceTypeEnum, measurementReviewStatusEnum, measurementSourceEnum, measurementStatusEnum, measurementTypeEnum, takeoffVersionStatusEnum, messageEntityTypeEnum, mobilePlatformEnum, offlineEntityTypeEnum, offlineOperationTypeEnum, offlineSyncStatusEnum, organizationDocumentTypeEnum, organizationDocumentVisibilityEnum, overheadCostActionEnum, overheadCostCategoryEnum, overheadCostFrequencyEnum, portalChatPriorityEnum, portalChatThreadCategoryEnum, portalChatThreadStatusEnum, pricebookImportJobStatusEnum, pricebookStatusEnum, pricingApprovalStatusEnum, pricingSourceTypeEnum, projectEquipmentPlanStatusEnum, repairStatusEnum, retentionActionEnum, retentionEntityTypeEnum, rewardTypeEnum, rfiCategoryEnum, rfiPriorityEnum, rfiStatusEnum, scheduleDependencyTypeEnum, scheduleGeneratedByEnum, scheduleTaskStatusEnum, socialAccountStatusEnum, socialPlatformEnum, socialPostStatusEnum, sovPaymentMethodEnum, sovStatusEnum, storedMaterialStatusEnum, retentionReleaseTypeEnum, retentionReleaseStatusEnum, sowAuditActionEnum, ssoProviderEnum, submittalCategoryEnum, submittalItemStatusEnum, submittalPhaseEnum, submittalReviewRoleEnum, submittalReviewStatusEnum, submittalStatusEnum, submittalTypeEnum, syncStatusEnum, tradeTypeEnum, transmittalStatusEnum, userRoleEnum, vendorEnrollmentStatusEnum, voiceLogStatusEnum, websiteDeploymentActionEnum, websitePageTypeEnum, websiteProjectStatusEnum, websiteStatusEnum, takeoffIssueCategoryEnum, takeoffIssueStatusEnum, talentAvailabilityEnum, talentProfileVisibilityEnum, workflowEntityTypeEnum, riskCategoryEnum, riskStatusEnum, workflowTemplateStatusEnum, workflowInstanceStatusEnum, videoCallStatusEnum, workflowNotificationChannelEnum, dotAgencyKindEnum, dotPayItemTypeEnum, dbeCertificationTypeEnum, suretyBondTypeEnum, suretyBondStatusEnum, haulTicketStatusEnum, swpppInspectionTypeEnum, idrStatusEnum, buyAmericaStatusEnum } from "../enums";
import { bids, organizations, projects, users } from "../core";
import { changeOrders, estimateLineItems, estimates, planDocuments, projectInspections, tasks, tmTickets } from "../operations";
import { crews } from "./crew";
import { rfis } from "./rfi";



// ============================================================
// INTERNAL MESSAGING SYSTEM
// Company-wide chat, group channels, and direct messages
// ============================================================

// Conversations table (channels and direct messages)
export const conversations = pgTable("conversations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  type: conversationTypeEnum("type").notNull(), // DIRECT, GROUP, COMPANY
  name: text("name"), // null for direct messages, required for groups/company
  description: text("description"),
  isCompanyChannel: boolean("is_company_channel").notNull().default(false), // The main company-wide channel
  channelSlug: text("channel_slug"), // non-null means this is a named Slack-style channel
  topic: text("topic"), // optional channel topic/purpose
  projectId: varchar("project_id").references(() => projects.id, { onDelete: "cascade" }),
  crewId: varchar("crew_id").references(() => crews.id, { onDelete: "cascade" }),
  rfiId: varchar("rfi_id").references(() => rfis.id, { onDelete: "set null" }),
  changeOrderId: varchar("change_order_id").references(() => changeOrders.id, { onDelete: "set null" }),
  taskId: varchar("task_id").references(() => tasks.id, { onDelete: "set null" }),
  isArchived: boolean("is_archived").notNull().default(false),
  createdById: varchar("created_by_id").notNull().references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  typeIdx: index("conversations_type_idx").on(table.type),
  orgIdx: index("conversations_org_idx").on(table.organizationId),
  channelSlugIdx: index("conversations_channel_slug_idx").on(table.channelSlug),
  projectIdIdx: index("conversations_project_id_idx").on(table.projectId),
  crewIdIdx: index("conversations_crew_id_idx").on(table.crewId),
  rfiIdIdx: index("conversations_rfi_id_idx").on(table.rfiId),
  changeOrderIdIdx: index("conversations_change_order_id_idx").on(table.changeOrderId),
  taskIdIdx: index("conversations_task_id_idx").on(table.taskId),
}));

// Conversation Participants table
export const conversationParticipants = pgTable("conversation_participants", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  conversationId: varchar("conversation_id").notNull().references(() => conversations.id, { onDelete: "cascade" }),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  joinedAt: timestamp("joined_at").notNull().defaultNow(),
  lastReadAt: timestamp("last_read_at"),
  isAdmin: boolean("is_admin").notNull().default(false), // For group channels
}, (table) => ({
  conversationUserIdx: index("conversation_participants_conv_user_idx").on(table.conversationId, table.userId),
  userIdx: index("conversation_participants_user_idx").on(table.userId),
  uniqueParticipant: unique("conversation_participants_unique").on(table.conversationId, table.userId),
}));

// Messages table
export const messages = pgTable("messages", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  conversationId: varchar("conversation_id").notNull().references(() => conversations.id, { onDelete: "cascade" }),
  senderId: varchar("sender_id").notNull().references(() => users.id),
  content: text("content").notNull(),
  attachmentUrl: text("attachment_url"),
  attachmentName: text("attachment_name"),
  attachmentType: text("attachment_type"),
  attachmentSize: integer("attachment_size"),
  voiceUrl: text("voice_url"),
  voiceDurationSeconds: integer("voice_duration_seconds"),
  mentionedTaskIds: text("mentioned_task_ids").array(),
  isEdited: boolean("is_edited").notNull().default(false),
  editedAt: timestamp("edited_at"),
  isDeleted: boolean("is_deleted").notNull().default(false),
  isFieldNote: boolean("is_field_note").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  conversationIdx: index("messages_conversation_idx").on(table.conversationId),
  senderIdx: index("messages_sender_idx").on(table.senderId),
  createdAtIdx: index("messages_created_at_idx").on(table.createdAt),
}));

// Message Reactions (emoji reactions on messages)
export const messageReactions = pgTable("message_reactions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  messageId: varchar("message_id").notNull().references(() => messages.id, { onDelete: "cascade" }),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  emoji: varchar("emoji", { length: 20 }).notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  messageUserEmojiIdx: unique("message_reactions_unique").on(table.messageId, table.userId, table.emoji),
  messageIdx: index("message_reactions_message_idx").on(table.messageId),
}));

// Message Read Receipts (for tracking who's read each message)
export const messageReadReceipts = pgTable("message_read_receipts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  messageId: varchar("message_id").notNull().references(() => messages.id, { onDelete: "cascade" }),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  readAt: timestamp("read_at").notNull().defaultNow(),
}, (table) => ({
  messageUserIdx: unique("message_read_receipts_unique").on(table.messageId, table.userId),
}));

export const messageEntityLinks = pgTable("message_entity_links", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  messageId: varchar("message_id").notNull().references(() => messages.id, { onDelete: "cascade" }),
  entityType: messageEntityTypeEnum("entity_type").notNull(),
  entityId: varchar("entity_id").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  messageIdx: index("message_entity_links_message_idx").on(table.messageId),
  entityIdx: index("message_entity_links_entity_idx").on(table.entityType, table.entityId),
  uniqueLink: unique("message_entity_links_unique").on(table.messageId, table.entityType, table.entityId),
}));

// Insert/Select Schemas for Messaging System
export const insertConversationSchema = createInsertSchema(conversations).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertConversation = z.infer<typeof insertConversationSchema>;
export type Conversation = typeof conversations.$inferSelect;

export const insertConversationParticipantSchema = createInsertSchema(conversationParticipants).omit({ id: true, joinedAt: true });
export type InsertConversationParticipant = z.infer<typeof insertConversationParticipantSchema>;
export type ConversationParticipant = typeof conversationParticipants.$inferSelect;

export const insertMessageSchema = createInsertSchema(messages).omit({ id: true, createdAt: true });
export type InsertMessage = z.infer<typeof insertMessageSchema>;
export type Message = typeof messages.$inferSelect;

export const insertMessageReadReceiptSchema = createInsertSchema(messageReadReceipts).omit({ id: true, readAt: true });
export type InsertMessageReadReceipt = z.infer<typeof insertMessageReadReceiptSchema>;
export type MessageReadReceipt = typeof messageReadReceipts.$inferSelect;

export const insertMessageEntityLinkSchema = createInsertSchema(messageEntityLinks).omit({ id: true, createdAt: true });
export type InsertMessageEntityLink = z.infer<typeof insertMessageEntityLinkSchema>;
export type MessageEntityLink = typeof messageEntityLinks.$inferSelect;

export const insertMessageReactionSchema = createInsertSchema(messageReactions).omit({ id: true, createdAt: true });
export type InsertMessageReaction = z.infer<typeof insertMessageReactionSchema>;
export type MessageReaction = typeof messageReactions.$inferSelect;

// Video Calls table
export const videoCalls = pgTable("video_calls", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  conversationId: varchar("conversation_id").notNull().references(() => conversations.id, { onDelete: "cascade" }),
  initiatorId: varchar("initiator_id").notNull().references(() => users.id),
  status: videoCallStatusEnum("status").notNull().default("RINGING"),
  startedAt: timestamp("started_at").notNull().defaultNow(),
  endedAt: timestamp("ended_at"),
}, (table) => ({
  conversationIdx: index("video_calls_conversation_idx").on(table.conversationId),
  statusIdx: index("video_calls_status_idx").on(table.status),
  uniqueActiveCall: uniqueIndex("video_calls_unique_active").on(table.conversationId).where(sql`status IN ('RINGING', 'ACTIVE')`),
}));

// Video Call Participants table
export const videoCallParticipants = pgTable("video_call_participants", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  callId: varchar("call_id").notNull().references(() => videoCalls.id, { onDelete: "cascade" }),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  joinedAt: timestamp("joined_at").notNull().defaultNow(),
  leftAt: timestamp("left_at"),
}, (table) => ({
  callUserIdx: unique("video_call_participants_unique").on(table.callId, table.userId),
  callIdx: index("video_call_participants_call_idx").on(table.callId),
}));

// Video Call Notes table
export const videoCallNotes = pgTable("video_call_notes", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  callId: varchar("call_id").notNull().references(() => videoCalls.id, { onDelete: "cascade" }),
  authorId: varchar("author_id").notNull().references(() => users.id),
  content: text("content").notNull().default(""),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  callIdx: index("video_call_notes_call_idx").on(table.callId),
  authorIdx: index("video_call_notes_author_idx").on(table.authorId),
}));

export const insertVideoCallSchema = createInsertSchema(videoCalls).omit({ id: true, startedAt: true });
export type InsertVideoCall = z.infer<typeof insertVideoCallSchema>;
export type VideoCall = typeof videoCalls.$inferSelect;

export const insertVideoCallParticipantSchema = createInsertSchema(videoCallParticipants).omit({ id: true, joinedAt: true });
export type InsertVideoCallParticipant = z.infer<typeof insertVideoCallParticipantSchema>;
export type VideoCallParticipant = typeof videoCallParticipants.$inferSelect;

export const insertVideoCallNoteSchema = createInsertSchema(videoCallNotes).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertVideoCallNote = z.infer<typeof insertVideoCallNoteSchema>;
export type VideoCallNote = typeof videoCallNotes.$inferSelect;