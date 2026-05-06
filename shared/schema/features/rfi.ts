// AUTO-GENERATED SPLIT FROM shared/schema/features.ts (Task #2426).
// Domain bucketing rule lives in shared/schema/features/index.ts.
import { sql } from "drizzle-orm";
import { pgTable, text, varchar, boolean, timestamp, date, decimal, integer, pgEnum, doublePrecision, index, unique, uniqueIndex, json, jsonb, type AnyPgColumn } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod";
import { addendumRecipientTypeEnum, addendumStatusEnum, aiBidDocumentAnalysisStatusEnum, aiCoDraftStatusEnum, aiContractDocumentAnalysisStatusEnum, contractStatusEnum, contractTypeEnum, contractRedlineStatusEnum, contractApprovalDecisionEnum, clauseCategoryEnum, signatureRequestStatusEnum, signerStatusEnum, aiInsightModuleEnum, aiInsightSeverityEnum, aiTakeoffModeEnum, aiTakeoffStatusEnum, aiTakeoffSuggestionStatusEnum, aiTakeoffRejectReasonEnum, aiTaskPriorityEnum, aiTaskStatusEnum, approvalEntityTypeEnum, approvalStatusEnum, atsProviderEnum, bidEquipmentSourceEnum, bidInvitationStatusEnum, bidRequestStatusEnum, bidResponseStatusEnum, blogCommentStatusEnum, blogPostStatusEnum, conversationTypeEnum, crewAvailabilityStatusEnum, crmActivityTypeEnum, crmCallDirectionEnum, crmCallOutcomeEnum, crmCallStatusEnum, crmCustomFieldEntityEnum, crmCustomFieldTypeEnum, crmContactRoleEnum, crmNoteTypeEnum, crmOrgStatusEnum, crmOrganisationTypeEnum, crmPipelineStageEnum, crmPreferredContactEnum, crmLostCategoryEnum, crmQuoteAcceptanceStatusEnum, crmLeadScoringOperatorEnum, crmSequenceStatusEnum, crmSequenceStepTypeEnum, crmSequenceEnrollmentStatusEnum, crmSequenceExecutionStatusEnum, crmSequenceEmailEventTypeEnum, crmSequenceExitReasonEnum, crmQuoteApprovalStatusEnum, dataSubjectRequestStatusEnum, dataSubjectRequestTypeEnum, documentRevisionSourceEnum, documentRevisionStatusEnum, emailClassificationEnum, emailProviderEnum, emailTaskSourceEnum, emailThreadStatusEnum, hiringActivityTypeEnum, hiringCandidateStageEnum, hiringCompensationTypeEnum, hiringEmploymentTypeEnum, hiringInterviewStatusEnum, hiringJobStatusEnum, hiringSyncStatusEnum, hustlerDelegateRoleEnum, hustlerLinkRequestStatusEnum, installationStatusEnum, lidarScanStatusEnum, lidarAnnotationTypeEnum, lidarComparisonTypeEnum, unifiedPaymentMethodEnum, unifiedPaymentStatusEnum, invoiceTypeEnum, integrationConnectionStatusEnum, integrationEventStatusEnum, integrationProviderEnum, issueSeverityEnum, issueStatusEnum, jobsiteAnalysisStatusEnum, lienWaiverStatusEnum, lienWaiverTypeEnum, locationLevelEnum, maintenanceTypeEnum, measurementReviewStatusEnum, measurementSourceEnum, measurementStatusEnum, measurementTypeEnum, takeoffVersionStatusEnum, messageEntityTypeEnum, mobilePlatformEnum, offlineEntityTypeEnum, offlineOperationTypeEnum, offlineSyncStatusEnum, organizationDocumentTypeEnum, organizationDocumentVisibilityEnum, overheadCostActionEnum, overheadCostCategoryEnum, overheadCostFrequencyEnum, portalChatPriorityEnum, portalChatThreadCategoryEnum, portalChatThreadStatusEnum, pricebookImportJobStatusEnum, pricebookStatusEnum, pricingApprovalStatusEnum, pricingSourceTypeEnum, projectEquipmentPlanStatusEnum, repairStatusEnum, retentionActionEnum, retentionEntityTypeEnum, rewardTypeEnum, rfiCategoryEnum, rfiPriorityEnum, rfiStatusEnum, scheduleDependencyTypeEnum, scheduleGeneratedByEnum, scheduleTaskStatusEnum, socialAccountStatusEnum, socialPlatformEnum, socialPostStatusEnum, sovPaymentMethodEnum, sovStatusEnum, storedMaterialStatusEnum, retentionReleaseTypeEnum, retentionReleaseStatusEnum, sowAuditActionEnum, ssoProviderEnum, submittalCategoryEnum, submittalItemStatusEnum, submittalPhaseEnum, submittalReviewRoleEnum, submittalReviewStatusEnum, submittalStatusEnum, submittalTypeEnum, syncStatusEnum, tradeTypeEnum, transmittalStatusEnum, userRoleEnum, vendorEnrollmentStatusEnum, voiceLogStatusEnum, websiteDeploymentActionEnum, websitePageTypeEnum, websiteProjectStatusEnum, websiteStatusEnum, takeoffIssueCategoryEnum, takeoffIssueStatusEnum, talentAvailabilityEnum, talentProfileVisibilityEnum, workflowEntityTypeEnum, riskCategoryEnum, riskStatusEnum, workflowTemplateStatusEnum, workflowInstanceStatusEnum, videoCallStatusEnum, workflowNotificationChannelEnum, dotAgencyKindEnum, dotPayItemTypeEnum, dbeCertificationTypeEnum, suretyBondTypeEnum, suretyBondStatusEnum, haulTicketStatusEnum, swpppInspectionTypeEnum, idrStatusEnum, buyAmericaStatusEnum } from "../enums";
import { bids, organizations, projects, users } from "../core";
import { changeOrders, estimateLineItems, estimates, planDocuments, projectInspections, tasks, tmTickets } from "../operations";
import { crmOrganisations } from "./crm";
import { subcontractorContracts } from "./subcontractor";



// ============================================================
// RFI (Request for Information) System
// ============================================================
export const rfis = pgTable("rfis", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  contractId: varchar("contract_id").references(() => subcontractorContracts.id, { onDelete: "set null" }),
  rfiNumber: text("rfi_number").notNull(),
  subject: text("subject").notNull(),
  question: text("question").notNull(),
  status: rfiStatusEnum("status").notNull().default("DRAFT"),
  priority: rfiPriorityEnum("priority").notNull().default("MEDIUM"),
  category: rfiCategoryEnum("category"),
  submittedById: varchar("submitted_by_id").notNull().references(() => users.id),
  submittedByName: text("submitted_by_name"),
  subcontractorId: varchar("subcontractor_id").references(() => crmOrganisations.id, { onDelete: "set null" }),
  assignedToId: varchar("assigned_to_id").references(() => users.id),
  dateSubmitted: timestamp("date_submitted"),
  dateRequired: timestamp("date_required"),
  dateAnswered: timestamp("date_answered"),
  answeredById: varchar("answered_by_id").references(() => users.id),
  answeredByName: text("answered_by_name"),
  answer: text("answer"),
  answerAttachmentsJson: text("answer_attachments_json"),
  drawingReference: text("drawing_reference"),
  specReference: text("spec_reference"),
  impactDescription: text("impact_description"),
  costImpact: boolean("cost_impact").default(false),
  scheduleImpact: boolean("schedule_impact").default(false),
  attachmentsJson: text("attachments_json"),
  linkedChangeOrderId: varchar("linked_change_order_id").references(() => changeOrders.id, { onDelete: "set null" }),
  linkedTmTicketId: varchar("linked_tm_ticket_id").references(() => tmTickets.id, { onDelete: "set null" }),
  linkedSubmittalId: varchar("linked_submittal_id").references((): AnyPgColumn => submittals.id, { onDelete: "set null" }),
  forwardedToId: varchar("forwarded_to_id").references(() => users.id),
  forwardedAt: timestamp("forwarded_at"),
  closedAt: timestamp("closed_at"),
  closedById: varchar("closed_by_id").references(() => users.id),
  // Task #1599: per-RFI dedupe marker + counter for the nightly overdue
  // escalation sweep (mirrors the SWPPP corrective-action pattern in
  // `processSwpppOverdueCorrectiveActions`). The initial fanout sets
  // the marker; daily follow-ups bump the counter until the per-org cap
  // is hit. Resolving the RFI (status -> ANSWERED/CLOSED) takes it out
  // of the SELECT so reminders stop naturally.
  lastOverdueNotifiedAt: timestamp("last_overdue_notified_at"),
  overdueReminderCount: integer("overdue_reminder_count").notNull().default(0),
  // Task #1599: lets a forwarded RFI go to an external A/E who has no
  // internal user account. Used in combination with the EXTERNAL_DOC_EMAIL
  // feature flag and a tokenized portal link.
  externalAssigneeEmail: text("external_assignee_email"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  orgIdx: index("rfis_org_idx").on(table.organizationId),
  projectIdx: index("rfis_project_idx").on(table.projectId),
  statusIdx: index("rfis_status_idx").on(table.status),
  contractIdx: index("rfis_contract_idx").on(table.contractId),
  subIdx: index("rfis_sub_idx").on(table.subcontractorId),
}));

export const rfiActivity = pgTable("rfi_activity", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  rfiId: varchar("rfi_id").notNull().references(() => rfis.id, { onDelete: "cascade" }),
  userId: varchar("user_id").notNull().references(() => users.id),
  userName: text("user_name"),
  action: text("action").notNull(),
  comment: text("comment"),
  attachmentsJson: text("attachments_json"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  rfiIdx: index("rfi_activity_rfi_idx").on(table.rfiId),
}));

export const insertRfiSchema = createInsertSchema(rfis).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertRfi = z.infer<typeof insertRfiSchema>;
export type Rfi = typeof rfis.$inferSelect;

export const insertRfiActivitySchema = createInsertSchema(rfiActivity).omit({ id: true, createdAt: true });
export type InsertRfiActivity = z.infer<typeof insertRfiActivitySchema>;
export type RfiActivity = typeof rfiActivity.$inferSelect;

export const rfiAttachments = pgTable("rfi_attachments", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  rfiId: varchar("rfi_id").notNull().references(() => rfis.id, { onDelete: "cascade" }),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  fileName: text("file_name").notNull(),
  fileSize: integer("file_size"),
  mimeType: text("mime_type"),
  storageKey: text("storage_key").notNull(),
  uploadedById: varchar("uploaded_by_id").notNull().references(() => users.id),
  uploadedByName: text("uploaded_by_name"),
  description: text("description"),
  isAnswerAttachment: boolean("is_answer_attachment").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  rfiIdx: index("rfi_attachments_rfi_idx").on(table.rfiId),
  orgIdx: index("rfi_attachments_org_idx").on(table.organizationId),
}));

export const insertRfiAttachmentSchema = createInsertSchema(rfiAttachments).omit({ id: true, createdAt: true });
export type InsertRfiAttachment = z.infer<typeof insertRfiAttachmentSchema>;
export type RfiAttachment = typeof rfiAttachments.$inferSelect;

// ============================================================
// Document Transmittal System
// ============================================================
export const documentTransmittals = pgTable("document_transmittals", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  transmittalNumber: text("transmittal_number").notNull(),
  subject: text("subject").notNull(),
  description: text("description"),
  status: transmittalStatusEnum("status").notNull().default("DRAFT"),
  sentById: varchar("sent_by_id").notNull().references(() => users.id),
  sentByName: text("sent_by_name"),
  dateSent: timestamp("date_sent"),
  documentType: text("document_type"),
  revisionNumber: text("revision_number"),
  previousTransmittalId: varchar("previous_transmittal_id"),
  attachmentsJson: text("attachments_json"),
  recipientSubcontractorIds: text("recipient_subcontractor_ids").array(),
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  orgIdx: index("transmittals_org_idx").on(table.organizationId),
  projectIdx: index("transmittals_project_idx").on(table.projectId),
  statusIdx: index("transmittals_status_idx").on(table.status),
}));

export const transmittalRecipients = pgTable("transmittal_recipients", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  transmittalId: varchar("transmittal_id").notNull().references(() => documentTransmittals.id, { onDelete: "cascade" }),
  subcontractorId: varchar("subcontractor_id").notNull().references(() => crmOrganisations.id, { onDelete: "cascade" }),
  subcontractorName: text("subcontractor_name"),
  acknowledged: boolean("acknowledged").notNull().default(false),
  acknowledgedAt: timestamp("acknowledged_at"),
  acknowledgedById: varchar("acknowledged_by_id").references(() => users.id),
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  transmittalIdx: index("transmittal_recipients_transmittal_idx").on(table.transmittalId),
  subIdx: index("transmittal_recipients_sub_idx").on(table.subcontractorId),
}));

export const insertDocumentTransmittalSchema = createInsertSchema(documentTransmittals).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertDocumentTransmittal = z.infer<typeof insertDocumentTransmittalSchema>;
export type DocumentTransmittal = typeof documentTransmittals.$inferSelect;

export const insertTransmittalRecipientSchema = createInsertSchema(transmittalRecipients).omit({ id: true, createdAt: true });
export type InsertTransmittalRecipient = z.infer<typeof insertTransmittalRecipientSchema>;
export type TransmittalRecipient = typeof transmittalRecipients.$inferSelect;

// ============================================================
// Submittal System
// ============================================================
export const submittals = pgTable("submittals", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  contractId: varchar("contract_id").references(() => subcontractorContracts.id, { onDelete: "set null" }),
  submittalNumber: text("submittal_number").notNull(),
  subject: text("subject").notNull(),
  description: text("description"),
  submittalType: submittalTypeEnum("submittal_type").notNull().default("CONTRACTOR"),
  phase: submittalPhaseEnum("phase").notNull().default("CONSTRUCTION"),
  status: submittalStatusEnum("status").notNull().default("DRAFT"),
  specSection: text("spec_section"),
  category: text("category"),
  submittalCategory: submittalCategoryEnum("submittal_category"),
  subcontractorId: varchar("subcontractor_id").references(() => crmOrganisations.id, { onDelete: "set null" }),
  submittedById: varchar("submitted_by_id").notNull().references(() => users.id),
  submittedByName: text("submitted_by_name"),
  dateSubmitted: timestamp("date_submitted"),
  dateRequired: timestamp("date_required"),
  reviewerId: varchar("reviewer_id").references(() => users.id),
  reviewerName: text("reviewer_name"),
  dateReviewed: timestamp("date_reviewed"),
  reviewComments: text("review_comments"),
  revisionNumber: integer("revision_number").notNull().default(1),
  previousSubmittalId: varchar("previous_submittal_id"),
  attachmentsJson: text("attachments_json"),
  stampAction: text("stamp_action"),
  linkedRfiId: varchar("linked_rfi_id").references((): AnyPgColumn => rfis.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  orgIdx: index("submittals_org_idx").on(table.organizationId),
  projectIdx: index("submittals_project_idx").on(table.projectId),
  statusIdx: index("submittals_status_idx").on(table.status),
  typeIdx: index("submittals_type_idx").on(table.submittalType),
  phaseIdx: index("submittals_phase_idx").on(table.phase),
  contractIdx: index("submittals_contract_idx").on(table.contractId),
  subIdx: index("submittals_sub_idx").on(table.subcontractorId),
}));

export const submittalActivity = pgTable("submittal_activity", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  submittalId: varchar("submittal_id").notNull().references(() => submittals.id, { onDelete: "cascade" }),
  userId: varchar("user_id").notNull().references(() => users.id),
  userName: text("user_name"),
  action: text("action").notNull(),
  comment: text("comment"),
  attachmentsJson: text("attachments_json"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  submittalIdx: index("submittal_activity_submittal_idx").on(table.submittalId),
}));

export const insertSubmittalSchema = createInsertSchema(submittals).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertSubmittal = z.infer<typeof insertSubmittalSchema>;
export type Submittal = typeof submittals.$inferSelect;

export const insertSubmittalActivitySchema = createInsertSchema(submittalActivity).omit({ id: true, createdAt: true });
export type InsertSubmittalActivity = z.infer<typeof insertSubmittalActivitySchema>;
export type SubmittalActivity = typeof submittalActivity.$inferSelect;

export const submittalItems = pgTable("submittal_items", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  submittalId: varchar("submittal_id").notNull().references(() => submittals.id, { onDelete: "cascade" }),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  itemNumber: integer("item_number").notNull(),
  description: text("description").notNull(),
  specSection: text("spec_section"),
  submittalCategory: submittalCategoryEnum("submittal_category"),
  quantity: decimal("quantity", { precision: 10, scale: 3 }),
  unit: text("unit"),
  manufacturer: text("manufacturer"),
  modelNumber: text("model_number"),
  notes: text("notes"),
  status: text("status").notNull().default("PENDING"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  submittalIdx: index("submittal_items_submittal_idx").on(table.submittalId),
  orgIdx: index("submittal_items_org_idx").on(table.organizationId),
  statusIdx: index("submittal_items_status_idx").on(table.status),
  submittalItemNumberUnique: unique("submittal_items_submittal_item_number_unique").on(table.submittalId, table.itemNumber),
}));

export const insertSubmittalItemSchema = createInsertSchema(submittalItems).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertSubmittalItem = z.infer<typeof insertSubmittalItemSchema>;
export type SubmittalItem = typeof submittalItems.$inferSelect;

export const submittalReviews = pgTable("submittal_reviews", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  submittalId: varchar("submittal_id").notNull().references(() => submittals.id, { onDelete: "cascade" }),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  reviewerRole: submittalReviewRoleEnum("reviewer_role").notNull(),
  reviewerId: varchar("reviewer_id").references(() => users.id, { onDelete: "set null" }),
  reviewerName: text("reviewer_name").notNull(),
  sequenceOrder: integer("sequence_order").notNull(),
  status: submittalReviewStatusEnum("status").notNull().default("PENDING"),
  comments: text("comments"),
  stampAction: text("stamp_action"),
  dateAssigned: timestamp("date_assigned"),
  dateReviewed: timestamp("date_reviewed"),
  // Task #1599: per-review dedupe marker + counter for the nightly
  // overdue escalation sweep. Only the *active* chain step (status
  // IN_REVIEW) is overdue-eligible — PENDING rows are future steps the
  // chain has not yet activated. Mirrors the SWPPP pattern; resolving
  // the active review (any non-IN_REVIEW status) removes it from the
  // SELECT so reminders stop naturally.
  lastOverdueNotifiedAt: timestamp("last_overdue_notified_at"),
  overdueReminderCount: integer("overdue_reminder_count").notNull().default(0),
  // Task #1599: lets the multi-party review chain route to an external
  // A/E who has no internal user account. Used in combination with the
  // EXTERNAL_DOC_EMAIL feature flag and a tokenized portal link.
  reviewerEmail: text("reviewer_email"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  submittalIdx: index("submittal_reviews_submittal_idx").on(table.submittalId),
  orgIdx: index("submittal_reviews_org_idx").on(table.organizationId),
  statusIdx: index("submittal_reviews_status_idx").on(table.status),
  seqIdx: index("submittal_reviews_seq_idx").on(table.sequenceOrder),
}));

export const insertSubmittalReviewSchema = createInsertSchema(submittalReviews).omit({ id: true, createdAt: true });
export type InsertSubmittalReview = z.infer<typeof insertSubmittalReviewSchema>;
export type SubmittalReview = typeof submittalReviews.$inferSelect;

export const submittalAttachments = pgTable("submittal_attachments", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  submittalId: varchar("submittal_id").notNull().references(() => submittals.id, { onDelete: "cascade" }),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  submittalItemId: varchar("submittal_item_id").references(() => submittalItems.id, { onDelete: "set null" }),
  submittalReviewId: varchar("submittal_review_id").references(() => submittalReviews.id, { onDelete: "set null" }),
  fileName: text("file_name").notNull(),
  fileSize: integer("file_size"),
  mimeType: text("mime_type"),
  storageKey: text("storage_key").notNull(),
  uploadedById: varchar("uploaded_by_id").notNull().references(() => users.id),
  uploadedByName: text("uploaded_by_name"),
  description: text("description"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  submittalIdx: index("submittal_attachments_submittal_idx").on(table.submittalId),
  orgIdx: index("submittal_attachments_org_idx").on(table.organizationId),
  itemIdx: index("submittal_attachments_item_idx").on(table.submittalItemId),
  reviewIdx: index("submittal_attachments_review_idx").on(table.submittalReviewId),
}));

export const insertSubmittalAttachmentSchema = createInsertSchema(submittalAttachments).omit({ id: true, createdAt: true });
export type InsertSubmittalAttachment = z.infer<typeof insertSubmittalAttachmentSchema>;
export type SubmittalAttachment = typeof submittalAttachments.$inferSelect;


// ============================================
// PROJECT EMAIL DISTRIBUTION LISTS
// Reusable named recipient lists for project email blasts (e.g. Gantt sends).
// ============================================
export const projectEmailDistributionLists = pgTable("project_email_distribution_lists", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  projectId: varchar("project_id").references(() => projects.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  contactEmails: text("contact_emails").array().notNull().default(sql`ARRAY[]::text[]`),
  extraEmails: text("extra_emails").array().notNull().default(sql`ARRAY[]::text[]`),
  createdById: varchar("created_by_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  orgIdx: index("project_email_lists_org_idx").on(table.organizationId),
  projectIdx: index("project_email_lists_project_idx").on(table.projectId),
  uniqueProjectName: uniqueIndex("project_email_lists_project_name_uniq").on(table.projectId, table.name),
  uniqueOrgName: uniqueIndex("project_email_lists_org_name_uniq")
    .on(table.organizationId, table.name)
    .where(sql`${table.projectId} IS NULL`),
}));
export const insertProjectEmailDistributionListSchema = createInsertSchema(projectEmailDistributionLists).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertProjectEmailDistributionList = z.infer<typeof insertProjectEmailDistributionListSchema>;
export type ProjectEmailDistributionList = typeof projectEmailDistributionLists.$inferSelect;

// ============================================
// PROJECT LOG EMAIL SCHEDULES (Task #1606)
// Per-project schedule for emailing the RFI / submittal log PDF to a
// project's distribution lists. Default cadence is OFF so an existing
// project sees no behaviour change until someone opts in. Recipients
// are derived from `project_email_distribution_lists` so existing list
// management screens already cover who gets what.
// ============================================
export const projectLogEmailSchedules = pgTable("project_log_email_schedules", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  // 'RFI' | 'SUBMITTAL' — one row per (project, log type).
  logType: text("log_type").notNull(),
  // 'OFF' | 'DAILY' | 'WEEKLY' | 'BIWEEKLY' — same vocabulary as the
  // certified payroll digest scheduler so admins see one consistent
  // cadence picker across the app.
  cadence: text("cadence").notNull().default("OFF"),
  // 0 = Sunday … 6 = Saturday. Honoured for WEEKLY and BIWEEKLY only;
  // DAILY ignores it. Default Monday matches the example in the task
  // brief ("weekly Monday-morning RFI/submittal log").
  weekday: integer("weekday").notNull().default(1),
  // Local hour (0-23) the digest should fire at. The cron runs hourly
  // and the worker compares the recipient timezone's local hour against
  // this column, so a project in America/Los_Angeles can pick "8am"
  // without coordinating with the server's wall-clock zone.
  hour: integer("hour").notNull().default(8),
  // IANA timezone identifier (e.g. "America/Los_Angeles"). Falls back
  // to the server default when the value is invalid or null.
  timezone: text("timezone").notNull().default("UTC"),
  // Stamped after a successful send so the worker can dedupe (DAILY
  // skips if <23h has elapsed) and BIWEEKLY can skip its off-week.
  lastSentAt: timestamp("last_sent_at"),
  // Task #1622 — per-attempt outcome tracking so project admins can see
  // when this morning's RFI / submittal log never went out (SendGrid
  // bounce, suppressed list, etc.) without having to check server logs
  // or wait for a recipient to complain. `lastAttemptAt` is stamped on
  // every attempt (success, failure, no-recipients), `lastAttemptStatus`
  // records which of those happened, and `lastAttemptError` carries a
  // short human-readable reason on the failure paths so the UI badge
  // can surface "Last send failed: <reason>". `lastAttemptRecipientCount`
  // captures how many addresses were tried so admins can tell apart
  // "we sent to 12 people" vs. "we tried but the list was empty".
  lastAttemptAt: timestamp("last_attempt_at"),
  lastAttemptStatus: text("last_attempt_status"),
  lastAttemptError: text("last_attempt_error"),
  lastAttemptRecipientCount: integer("last_attempt_recipient_count"),
  // Task #1637 — track who last edited the cadence so the worker can
  // fan a one-shot in-app notification to that user (alongside the
  // project manager) when a scheduled send transitions into FAILURE
  // or NO_RECIPIENTS. Stamped by `PUT /api/projects/:projectId/log-email-schedules/:logType`
  // on every upsert. Nullable + ON DELETE SET NULL so deleting the
  // editing user doesn't block the row.
  lastEditedById: varchar("last_edited_by_id").references(() => users.id, { onDelete: "set null" }),
  // Task #1637 — dedupe marker for the failure fan-out. Stamped with
  // the schedule's most recently NOTIFIED-about failure status (one of
  // "FAILURE" | "NO_RECIPIENTS"). The cron only fans a fresh
  // notification when the current attempt's status differs from this
  // value, so the same persistent failure isn't re-notified every
  // hourly tick. Cleared back to NULL on a successful send so the
  // next failure starts a brand-new notification cycle.
  lastFailureNotifiedAt: timestamp("last_failure_notified_at"),
  lastFailureNotifiedStatus: text("last_failure_notified_status"),
  // Task #1651 — running tally of consecutive FAILURE / NO_RECIPIENTS
  // attempts since the last SUCCESS. Bumped on every failed attempt
  // (cron or manual send-now) and reset to 0 on a successful send so
  // a single recovery clears the streak. Once the count crosses the
  // configured threshold (default 3, env-overridable via
  // PROJECT_LOG_EMAIL_FAILURE_THRESHOLD, additionally per-org
  // overridable via `organizations.project_log_email_failure_threshold`
  // — Task #1668) the worker fans out a backstop notification to
  // every ADMIN/MANAGER/SUPER_ADMIN in the org so a project's
  // distribution list can't quietly stay broken for weeks just because
  // nobody opened the project settings page. Defaults to 0 so existing
  // rows behave as if they had no prior failures the first time the
  // new worker observes them.
  consecutiveFailureCount: integer("consecutive_failure_count").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  orgIdx: index("project_log_email_schedules_org_idx").on(table.organizationId),
  projectIdx: index("project_log_email_schedules_project_idx").on(table.projectId),
  // One row per (project, log type) — the PUT endpoint upserts on this
  // pair and the cron iterates over distinct rows so we never email the
  // same log twice in the same firing.
  uniqueProjectLogType: uniqueIndex("project_log_email_schedules_project_logtype_uniq").on(table.projectId, table.logType),
}));
export const insertProjectLogEmailScheduleSchema = createInsertSchema(projectLogEmailSchedules).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertProjectLogEmailSchedule = z.infer<typeof insertProjectLogEmailScheduleSchema>;
export type ProjectLogEmailSchedule = typeof projectLogEmailSchedules.$inferSelect;

export const PROJECT_LOG_EMAIL_LOG_TYPES = ["RFI", "SUBMITTAL"] as const;
export type ProjectLogEmailLogType = typeof PROJECT_LOG_EMAIL_LOG_TYPES[number];
export const PROJECT_LOG_EMAIL_CADENCES = ["OFF", "DAILY", "WEEKLY", "BIWEEKLY"] as const;
export type ProjectLogEmailCadence = typeof PROJECT_LOG_EMAIL_CADENCES[number];
// Task #1622 — vocabulary stamped onto `last_attempt_status`.
// SUCCESS: SendGrid/Resend accepted the message for delivery.
// FAILURE: the transport returned an error (bounce, auth issue, etc).
// NO_RECIPIENTS: the schedule was due, but the resolved distribution
//   lists yielded zero deliverable addresses. Surfacing this distinct
//   from FAILURE lets the UI nudge admins to fix the address book
//   instead of suspecting their mail provider.
export const PROJECT_LOG_EMAIL_ATTEMPT_STATUSES = ["SUCCESS", "FAILURE", "NO_RECIPIENTS"] as const;
export type ProjectLogEmailAttemptStatus = typeof PROJECT_LOG_EMAIL_ATTEMPT_STATUSES[number];

// ============================================
// Task #1652 — per-schedule send history
// ============================================
// Append-only history of every attempt the cron + manual "Send now"
// button make against a `project_log_email_schedules` row. The
// schedule row keeps its `last_attempt_*` columns (Task #1622) so
// the existing badge UI doesn't have to change, but trend-debugging
// "this failed 5 times this week, then succeeded after I edited the
// list" needs more than the most-recent attempt — that's what this
// table is for.
//
// Each row is immutable once written. ON DELETE CASCADE on the
// schedule + project + organization so the history follows the
// schedule's lifecycle. `triggeredById` is ON DELETE SET NULL so
// removing a user keeps the audit trail intact even if the actor
// is gone.
export const projectLogEmailScheduleAttempts = pgTable("project_log_email_schedule_attempts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  scheduleId: varchar("schedule_id").notNull().references(() => projectLogEmailSchedules.id, { onDelete: "cascade" }),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  // 'RFI' | 'SUBMITTAL' — mirrored from the schedule so reads don't
  // need a join to render the attempt row.
  logType: text("log_type").notNull(),
  // 'SUCCESS' | 'FAILURE' | 'NO_RECIPIENTS', same vocabulary as the
  // last_attempt_status column on the schedule.
  status: text("status").notNull(),
  // Human-readable reason on FAILURE / NO_RECIPIENTS, NULL on SUCCESS.
  error: text("error"),
  // How many addresses we tried so admins can distinguish
  // "12 sent" from "0 sent because the list was empty".
  recipientCount: integer("recipient_count").notNull().default(0),
  // 'CRON' | 'MANUAL'. Lets the UI distinguish scheduled runs from
  // admin-triggered retries at a glance.
  triggerType: text("trigger_type").notNull(),
  // Set when triggerType = MANUAL so the audit trail shows who
  // clicked "Send now". NULL on CRON ticks.
  triggeredById: varchar("triggered_by_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  scheduleIdx: index("project_log_email_schedule_attempts_schedule_idx").on(table.scheduleId, table.createdAt),
  orgIdx: index("project_log_email_schedule_attempts_org_idx").on(table.organizationId),
}));
export const insertProjectLogEmailScheduleAttemptSchema = createInsertSchema(projectLogEmailScheduleAttempts).omit({ id: true, createdAt: true });
export type InsertProjectLogEmailScheduleAttempt = z.infer<typeof insertProjectLogEmailScheduleAttemptSchema>;
export type ProjectLogEmailScheduleAttempt = typeof projectLogEmailScheduleAttempts.$inferSelect;

export const PROJECT_LOG_EMAIL_TRIGGER_TYPES = ["CRON", "MANUAL"] as const;
export type ProjectLogEmailTriggerType = typeof PROJECT_LOG_EMAIL_TRIGGER_TYPES[number];