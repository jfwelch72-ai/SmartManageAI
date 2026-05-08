// AUTO-GENERATED SPLIT FROM shared/schema/features.ts (Task #2426).
// Domain bucketing rule lives in shared/schema/features/index.ts.
import { sql } from "drizzle-orm";
import { pgTable, text, varchar, boolean, timestamp, date, decimal, integer, pgEnum, doublePrecision, index, unique, uniqueIndex, json, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod";
import { addendumRecipientTypeEnum, addendumStatusEnum, aiBidDocumentAnalysisStatusEnum, aiCoDraftStatusEnum, aiContractDocumentAnalysisStatusEnum, contractStatusEnum, contractTypeEnum, contractRedlineStatusEnum, contractApprovalDecisionEnum, clauseCategoryEnum, signatureRequestStatusEnum, signerStatusEnum, aiInsightModuleEnum, aiInsightSeverityEnum, aiTakeoffModeEnum, aiTakeoffStatusEnum, aiTakeoffSuggestionStatusEnum, aiTakeoffRejectReasonEnum, aiTaskPriorityEnum, aiTaskStatusEnum, approvalEntityTypeEnum, approvalStatusEnum, atsProviderEnum, bidEquipmentSourceEnum, bidInvitationStatusEnum, bidRequestStatusEnum, bidResponseStatusEnum, blogCommentStatusEnum, blogPostStatusEnum, conversationTypeEnum, crewAvailabilityStatusEnum, crmActivityTypeEnum, crmCallDirectionEnum, crmCallOutcomeEnum, crmCallStatusEnum, crmCustomFieldEntityEnum, crmCustomFieldTypeEnum, crmContactRoleEnum, crmNoteTypeEnum, crmOrgStatusEnum, crmOrganisationTypeEnum, crmPipelineStageEnum, crmPreferredContactEnum, crmLostCategoryEnum, crmQuoteAcceptanceStatusEnum, crmLeadScoringOperatorEnum, crmSequenceStatusEnum, crmSequenceStepTypeEnum, crmSequenceEnrollmentStatusEnum, crmSequenceExecutionStatusEnum, crmSequenceEmailEventTypeEnum, crmSequenceExitReasonEnum, crmQuoteApprovalStatusEnum, dataSubjectRequestStatusEnum, dataSubjectRequestTypeEnum, documentRevisionSourceEnum, documentRevisionStatusEnum, emailClassificationEnum, emailProviderEnum, emailTaskSourceEnum, emailThreadStatusEnum, hiringActivityTypeEnum, hiringCandidateStageEnum, hiringCompensationTypeEnum, hiringEmploymentTypeEnum, hiringInterviewStatusEnum, hiringJobStatusEnum, hiringSyncStatusEnum, hustlerDelegateRoleEnum, hustlerLinkRequestStatusEnum, installationStatusEnum, lidarScanStatusEnum, lidarAnnotationTypeEnum, lidarComparisonTypeEnum, unifiedPaymentMethodEnum, unifiedPaymentStatusEnum, invoiceTypeEnum, integrationConnectionStatusEnum, integrationEventStatusEnum, integrationProviderEnum, issueSeverityEnum, issueStatusEnum, jobsiteAnalysisStatusEnum, lienWaiverStatusEnum, lienWaiverTypeEnum, locationLevelEnum, maintenanceTypeEnum, measurementReviewStatusEnum, measurementSourceEnum, measurementStatusEnum, measurementTypeEnum, takeoffVersionStatusEnum, messageEntityTypeEnum, mobilePlatformEnum, offlineEntityTypeEnum, offlineOperationTypeEnum, offlineSyncStatusEnum, organizationDocumentTypeEnum, organizationDocumentVisibilityEnum, overheadCostActionEnum, overheadCostCategoryEnum, overheadCostFrequencyEnum, portalChatPriorityEnum, portalChatThreadCategoryEnum, portalChatThreadStatusEnum, pricebookImportJobStatusEnum, pricebookStatusEnum, pricingApprovalStatusEnum, pricingSourceTypeEnum, projectEquipmentPlanStatusEnum, repairStatusEnum, retentionActionEnum, retentionEntityTypeEnum, rewardTypeEnum, rfiCategoryEnum, rfiPriorityEnum, rfiStatusEnum, scheduleDependencyTypeEnum, scheduleGeneratedByEnum, scheduleTaskStatusEnum, socialAccountStatusEnum, socialPlatformEnum, socialPostStatusEnum, sovPaymentMethodEnum, sovStatusEnum, storedMaterialStatusEnum, retentionReleaseTypeEnum, retentionReleaseStatusEnum, sowAuditActionEnum, ssoProviderEnum, submittalCategoryEnum, submittalItemStatusEnum, submittalPhaseEnum, submittalReviewRoleEnum, submittalReviewStatusEnum, submittalStatusEnum, submittalTypeEnum, syncStatusEnum, tradeTypeEnum, transmittalStatusEnum, userRoleEnum, vendorEnrollmentStatusEnum, voiceLogStatusEnum, websiteDeploymentActionEnum, websitePageTypeEnum, websiteProjectStatusEnum, websiteStatusEnum, takeoffIssueCategoryEnum, takeoffIssueStatusEnum, talentAvailabilityEnum, talentProfileVisibilityEnum, workflowEntityTypeEnum, riskCategoryEnum, riskStatusEnum, workflowTemplateStatusEnum, workflowInstanceStatusEnum, videoCallStatusEnum, workflowNotificationChannelEnum, dotAgencyKindEnum, dotPayItemTypeEnum, dbeCertificationTypeEnum, suretyBondTypeEnum, suretyBondStatusEnum, haulTicketStatusEnum, swpppInspectionTypeEnum, idrStatusEnum, buyAmericaStatusEnum } from "../enums";
import { bids, organizations, projects, users } from "../core";
import { changeOrders, estimateLineItems, estimates, planDocuments, projectInspections, tasks, tmTickets } from "../operations";



// ============================================
// FEATURE G: MOBILE DEVICES & SYNC
// Device registration and offline sync support
// ============================================
export const mobileDevices = pgTable("mobile_devices", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  deviceId: text("device_id").notNull().unique(),
  platform: mobilePlatformEnum("platform").notNull(),
  appVersion: text("app_version"),
  deviceModel: text("device_model"),
  pushToken: text("push_token"),
  lastSyncAt: timestamp("last_sync_at"),
  syncToken: text("sync_token"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  userIdx: index("mobile_devices_user_idx").on(table.userId),
  orgIdx: index("mobile_devices_org_idx").on(table.organizationId),
}));

export const insertMobileDeviceSchema = createInsertSchema(mobileDevices).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertMobileDevice = z.infer<typeof insertMobileDeviceSchema>;
export type MobileDevice = typeof mobileDevices.$inferSelect;

export const mobileSyncLog = pgTable("mobile_sync_log", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  deviceId: varchar("device_id").notNull().references(() => mobileDevices.id, { onDelete: "cascade" }),
  syncType: text("sync_type").notNull(),              // PULL, PUSH, FULL
  syncStartedAt: timestamp("sync_started_at").notNull(),
  syncCompletedAt: timestamp("sync_completed_at"),
  recordsDownloaded: integer("records_downloaded").notNull().default(0),
  recordsUploaded: integer("records_uploaded").notNull().default(0),
  conflicts: integer("conflicts").notNull().default(0),
  status: syncStatusEnum("status").notNull().default("IN_PROGRESS"),
  errorMessage: text("error_message"),
  metadataJson: text("metadata_json"),
}, (table) => ({
  deviceIdx: index("sync_log_device_idx").on(table.deviceId),
}));

export const insertMobileSyncLogSchema = createInsertSchema(mobileSyncLog).omit({ id: true });
export type InsertMobileSyncLog = z.infer<typeof insertMobileSyncLogSchema>;
export type MobileSyncLog = typeof mobileSyncLog.$inferSelect;

export const mobilePendingUploads = pgTable("mobile_pending_uploads", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  deviceId: varchar("device_id").notNull().references(() => mobileDevices.id, { onDelete: "cascade" }),
  localId: text("local_id").notNull(),
  recordType: text("record_type").notNull(),
  recordDataJson: text("record_data_json").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  processedAt: timestamp("processed_at"),
  status: text("status").notNull().default("PENDING"),
  errorMessage: text("error_message"),
}, (table) => ({
  deviceIdx: index("pending_uploads_device_idx").on(table.deviceId),
}));

export const insertMobilePendingUploadSchema = createInsertSchema(mobilePendingUploads).omit({ id: true, createdAt: true });
export type InsertMobilePendingUpload = z.infer<typeof insertMobilePendingUploadSchema>;
export type MobilePendingUpload = typeof mobilePendingUploads.$inferSelect;

// Offline Sync Queue table - Queue for offline operations
export const offlineSyncQueue = pgTable("offline_sync_queue", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  
  // Operation details
  operationType: offlineOperationTypeEnum("operation_type").notNull(),
  entityType: offlineEntityTypeEnum("entity_type").notNull(),
  entityId: varchar("entity_id"),  // Local ID before sync
  payload: json("payload").notNull(),  // The data to sync
  
  // Sync status
  status: offlineSyncStatusEnum("status").notNull().default("PENDING"),
  syncedAt: timestamp("synced_at"),
  syncedEntityId: varchar("synced_entity_id"),  // Server ID after sync
  
  // Error handling
  errorMessage: text("error_message"),
  retryCount: integer("retry_count").notNull().default(0),
  lastRetryAt: timestamp("last_retry_at"),
  
  // Metadata
  deviceId: text("device_id"),
  clientTimestamp: timestamp("client_timestamp"),
  // Task #2693: Lamport logical clock from the mobile device. Added to the DB
  // via migration 0108 / ensureMobileSyncEventsTable; column kept here so the
  // Drizzle type matches the live schema and avoids insert/select drift.
  logicalClock: integer("logical_clock"),

  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  orgIdx: index("offline_sync_org_idx").on(table.organizationId),
  userIdx: index("offline_sync_user_idx").on(table.userId),
  statusIdx: index("offline_sync_status_idx").on(table.status),
  entityIdx: index("offline_sync_entity_idx").on(table.entityType, table.entityId),
}));

export const insertOfflineSyncQueueSchema = createInsertSchema(offlineSyncQueue).omit({ id: true, createdAt: true, updatedAt: true, syncedAt: true });
export type InsertOfflineSyncQueue = z.infer<typeof insertOfflineSyncQueueSchema>;
export type OfflineSyncQueue = typeof offlineSyncQueue.$inferSelect;