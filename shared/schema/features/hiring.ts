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
// HIRING MODULE TABLES
// ============================================

export const hiringJobs = pgTable("hiring_jobs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  externalProvider: atsProviderEnum("external_provider"),
  externalJobId: text("external_job_id"),
  title: text("title").notNull(),
  department: text("department"),
  trade: text("trade"),
  employmentType: hiringEmploymentTypeEnum("employment_type"),
  location: text("location"),
  compensationType: hiringCompensationTypeEnum("compensation_type"),
  compensationMin: decimal("compensation_min", { precision: 12, scale: 2 }),
  compensationMax: decimal("compensation_max", { precision: 12, scale: 2 }),
  description: text("description"),
  requirements: text("requirements"),
  preferredQualifications: text("preferred_qualifications"),
  certificationsRequired: text("certifications_required"),
  screeningQuestionsJson: text("screening_questions_json"),
  postingDestinationsJson: text("posting_destinations_json"),
  internalNotes: text("internal_notes"),
  status: hiringJobStatusEnum("status").notNull().default("DRAFT"),
  assignedOwnerUserId: varchar("assigned_owner_user_id").references(() => users.id, { onDelete: "set null" }),
  createdByUserId: varchar("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
  updatedByUserId: varchar("updated_by_user_id").references(() => users.id, { onDelete: "set null" }),
  publishedAt: timestamp("published_at"),
  archivedAt: timestamp("archived_at"),
  lastSyncedAt: timestamp("last_synced_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  orgIdx: index("hiring_jobs_org_idx").on(table.organizationId),
  statusIdx: index("hiring_jobs_status_idx").on(table.status),
  externalIdx: index("hiring_jobs_external_idx").on(table.externalJobId),
}));

export const insertHiringJobSchema = createInsertSchema(hiringJobs).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertHiringJob = z.infer<typeof insertHiringJobSchema>;
export type HiringJob = typeof hiringJobs.$inferSelect;

export const hiringJobTemplates = pgTable("hiring_job_templates", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  trade: text("trade"),
  employmentType: hiringEmploymentTypeEnum("employment_type"),
  description: text("description"),
  requirements: text("requirements"),
  certificationsRequired: text("certifications_required"),
  screeningQuestionsJson: text("screening_questions_json"),
  isGlobal: boolean("is_global").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  orgIdx: index("hiring_job_templates_org_idx").on(table.organizationId),
  globalIdx: index("hiring_job_templates_global_idx").on(table.isGlobal),
}));

export const insertHiringJobTemplateSchema = createInsertSchema(hiringJobTemplates).omit({ id: true, createdAt: true });
export type InsertHiringJobTemplate = z.infer<typeof insertHiringJobTemplateSchema>;
export type HiringJobTemplate = typeof hiringJobTemplates.$inferSelect;

export const hiringCandidates = pgTable("hiring_candidates", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  jobId: varchar("job_id").references(() => hiringJobs.id, { onDelete: "cascade" }),
  externalProvider: atsProviderEnum("external_provider"),
  externalCandidateId: text("external_candidate_id"),
  firstName: text("first_name").notNull(),
  lastName: text("last_name").notNull(),
  fullName: text("full_name").notNull(),
  email: text("email"),
  phone: text("phone"),
  city: text("city"),
  state: text("state"),
  source: text("source"),
  currentStage: text("current_stage").notNull().default("APPLIED"),
  appliedAt: timestamp("applied_at").notNull().defaultNow(),
  reviewerUserId: varchar("reviewer_user_id").references(() => users.id, { onDelete: "set null" }),
  aiScore: integer("ai_score"),
  aiRecommendation: text("ai_recommendation"),
  status: text("status").notNull().default("active"),
  rawPayloadJson: text("raw_payload_json"),
  resumeStorageKey: text("resume_storage_key"),
  applicationAnswersJson: text("application_answers_json"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  orgIdx: index("hiring_candidates_org_idx").on(table.organizationId),
  jobIdx: index("hiring_candidates_job_idx").on(table.jobId),
  stageIdx: index("hiring_candidates_stage_idx").on(table.currentStage),
  appliedAtIdx: index("hiring_candidates_applied_at_idx").on(table.appliedAt),
  reviewerIdx: index("hiring_candidates_reviewer_idx").on(table.reviewerUserId),
  externalIdx: index("hiring_candidates_external_idx").on(table.externalCandidateId),
}));

export const insertHiringCandidateSchema = createInsertSchema(hiringCandidates).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertHiringCandidate = z.infer<typeof insertHiringCandidateSchema>;
export type HiringCandidate = typeof hiringCandidates.$inferSelect;

export const hiringCandidateDocuments = pgTable("hiring_candidate_documents", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  candidateId: varchar("candidate_id").notNull().references(() => hiringCandidates.id, { onDelete: "cascade" }),
  fileName: text("file_name").notNull(),
  fileSize: integer("file_size"),
  mimeType: text("mime_type"),
  storageKey: text("storage_key").notNull(),
  uploadedByUserId: varchar("uploaded_by_user_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  candidateIdx: index("hiring_candidate_documents_candidate_idx").on(table.candidateId),
  orgIdx: index("hiring_candidate_documents_org_idx").on(table.organizationId),
}));

export const insertHiringCandidateDocumentSchema = createInsertSchema(hiringCandidateDocuments).omit({ id: true, createdAt: true });
export type InsertHiringCandidateDocument = z.infer<typeof insertHiringCandidateDocumentSchema>;
export type HiringCandidateDocument = typeof hiringCandidateDocuments.$inferSelect;

export const hiringCandidateNotes = pgTable("hiring_candidate_notes", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  candidateId: varchar("candidate_id").notNull().references(() => hiringCandidates.id, { onDelete: "cascade" }),
  authorUserId: varchar("author_user_id").references(() => users.id, { onDelete: "set null" }),
  authorName: text("author_name").notNull(),
  body: text("body").notNull(),
  isInternal: boolean("is_internal").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  candidateIdx: index("hiring_candidate_notes_candidate_idx").on(table.candidateId),
  orgIdx: index("hiring_candidate_notes_org_idx").on(table.organizationId),
}));

export const insertHiringCandidateNoteSchema = createInsertSchema(hiringCandidateNotes).omit({ id: true, createdAt: true });
export type InsertHiringCandidateNote = z.infer<typeof insertHiringCandidateNoteSchema>;
export type HiringCandidateNote = typeof hiringCandidateNotes.$inferSelect;

export const hiringCandidateStageHistory = pgTable("hiring_candidate_stage_history", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  candidateId: varchar("candidate_id").notNull().references(() => hiringCandidates.id, { onDelete: "cascade" }),
  fromStage: text("from_stage"),
  toStage: text("to_stage").notNull(),
  changedByUserId: varchar("changed_by_user_id").references(() => users.id, { onDelete: "set null" }),
  changedByName: text("changed_by_name"),
  reason: text("reason"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  candidateIdx: index("hiring_candidate_stage_history_candidate_idx").on(table.candidateId),
  orgIdx: index("hiring_candidate_stage_history_org_idx").on(table.organizationId),
}));

export const insertHiringCandidateStageHistorySchema = createInsertSchema(hiringCandidateStageHistory).omit({ id: true, createdAt: true });
export type InsertHiringCandidateStageHistory = z.infer<typeof insertHiringCandidateStageHistorySchema>;
export type HiringCandidateStageHistory = typeof hiringCandidateStageHistory.$inferSelect;

export const hiringInterviews = pgTable("hiring_interviews", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  candidateId: varchar("candidate_id").notNull().references(() => hiringCandidates.id, { onDelete: "cascade" }),
  jobId: varchar("job_id").references(() => hiringJobs.id, { onDelete: "set null" }),
  interviewType: text("interview_type").notNull().default("PHONE_SCREEN"),
  startAt: timestamp("start_at"),
  endAt: timestamp("end_at"),
  timezone: text("timezone").notNull().default("America/New_York"),
  location: text("location"),
  videoLink: text("video_link"),
  interviewerUserIdsJson: text("interviewer_user_ids_json"),
  status: hiringInterviewStatusEnum("status").notNull().default("SCHEDULED"),
  notes: text("notes"),
  reminderSentAt: timestamp("reminder_sent_at"),
  createdByUserId: varchar("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
  updatedByUserId: varchar("updated_by_user_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  candidateIdx: index("hiring_interviews_candidate_idx").on(table.candidateId),
  orgIdx: index("hiring_interviews_org_idx").on(table.organizationId),
  statusIdx: index("hiring_interviews_status_idx").on(table.status),
  startAtIdx: index("hiring_interviews_start_at_idx").on(table.startAt),
}));

export const insertHiringInterviewSchema = createInsertSchema(hiringInterviews).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertHiringInterview = z.infer<typeof insertHiringInterviewSchema>;
export type HiringInterview = typeof hiringInterviews.$inferSelect;

export const hiringTasks = pgTable("hiring_tasks", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  candidateId: varchar("candidate_id").references(() => hiringCandidates.id, { onDelete: "cascade" }),
  jobId: varchar("job_id").references(() => hiringJobs.id, { onDelete: "set null" }),
  title: text("title").notNull(),
  description: text("description"),
  assignedUserId: varchar("assigned_user_id").references(() => users.id, { onDelete: "set null" }),
  dueDate: timestamp("due_date"),
  completedAt: timestamp("completed_at"),
  status: text("status").notNull().default("open"),
  createdByUserId: varchar("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  orgIdx: index("hiring_tasks_org_idx").on(table.organizationId),
  candidateIdx: index("hiring_tasks_candidate_idx").on(table.candidateId),
  statusIdx: index("hiring_tasks_status_idx").on(table.status),
}));

export const insertHiringTaskSchema = createInsertSchema(hiringTasks).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertHiringTask = z.infer<typeof insertHiringTaskSchema>;
export type HiringTask = typeof hiringTasks.$inferSelect;

export const hiringIntegrations = pgTable("hiring_integrations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  providerName: atsProviderEnum("provider_name").notNull(),
  encryptedCredentialsJson: text("encrypted_credentials_json"),
  status: text("status").notNull().default("disconnected"),
  lastSyncAt: timestamp("last_sync_at"),
  lastTestAt: timestamp("last_test_at"),
  defaultConfigJson: text("default_config_json"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  orgIdx: index("hiring_integrations_org_idx").on(table.organizationId),
  providerIdx: index("hiring_integrations_provider_idx").on(table.providerName),
}));

export const insertHiringIntegrationSchema = createInsertSchema(hiringIntegrations).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertHiringIntegration = z.infer<typeof insertHiringIntegrationSchema>;
export type HiringIntegration = typeof hiringIntegrations.$inferSelect;

export const hiringSyncLogs = pgTable("hiring_sync_logs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  integrationId: varchar("integration_id").references(() => hiringIntegrations.id, { onDelete: "set null" }),
  provider: atsProviderEnum("provider"),
  status: hiringSyncStatusEnum("status").notNull().default("PENDING"),
  entityType: text("entity_type"),
  recordsProcessed: integer("records_processed").notNull().default(0),
  recordsFailed: integer("records_failed").notNull().default(0),
  errorSummary: text("error_summary"),
  startedAt: timestamp("started_at").notNull().defaultNow(),
  completedAt: timestamp("completed_at"),
}, (table) => ({
  orgIdx: index("hiring_sync_logs_org_idx").on(table.organizationId),
  statusIdx: index("hiring_sync_logs_status_idx").on(table.status),
  startedAtIdx: index("hiring_sync_logs_started_at_idx").on(table.startedAt),
}));

export const insertHiringSyncLogSchema = createInsertSchema(hiringSyncLogs).omit({ id: true });
export type InsertHiringSyncLog = z.infer<typeof insertHiringSyncLogSchema>;
export type HiringSyncLog = typeof hiringSyncLogs.$inferSelect;

export const hiringAiReviews = pgTable("hiring_ai_reviews", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  candidateId: varchar("candidate_id").notNull().references(() => hiringCandidates.id, { onDelete: "cascade" }),
  modelName: text("model_name").notNull(),
  score: integer("score"),
  summary: text("summary"),
  strengthsJson: text("strengths_json"),
  concernsJson: text("concerns_json"),
  extractedSkillsJson: text("extracted_skills_json"),
  extractedCertsJson: text("extracted_certs_json"),
  extractedEquipmentJson: text("extracted_equipment_json"),
  tradeFitScore: integer("trade_fit_score"),
  roleFitScore: integer("role_fit_score"),
  redFlagsJson: text("red_flags_json"),
  recommendation: text("recommendation"),
  interviewRecommendation: text("interview_recommendation"),
  confidenceScore: integer("confidence_score"),
  promptVersion: text("prompt_version"),
  generatedAt: timestamp("generated_at").notNull().defaultNow(),
}, (table) => ({
  candidateIdx: index("hiring_ai_reviews_candidate_idx").on(table.candidateId),
  orgIdx: index("hiring_ai_reviews_org_idx").on(table.organizationId),
}));

export const insertHiringAiReviewSchema = createInsertSchema(hiringAiReviews).omit({ id: true, generatedAt: true });
export type InsertHiringAiReview = z.infer<typeof insertHiringAiReviewSchema>;
export type HiringAiReview = typeof hiringAiReviews.$inferSelect;

export const hiringPipelineConfigs = pgTable("hiring_pipeline_configs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  stagesJson: text("stages_json"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  orgIdx: index("hiring_pipeline_configs_org_idx").on(table.organizationId),
}));

export const insertHiringPipelineConfigSchema = createInsertSchema(hiringPipelineConfigs).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertHiringPipelineConfig = z.infer<typeof insertHiringPipelineConfigSchema>;
export type HiringPipelineConfig = typeof hiringPipelineConfigs.$inferSelect;

export const hiringActivityLogs = pgTable("hiring_activity_logs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  actorUserId: varchar("actor_user_id").references(() => users.id, { onDelete: "set null" }),
  actorName: text("actor_name"),
  activityType: hiringActivityTypeEnum("activity_type").notNull(),
  entityType: text("entity_type"),
  entityId: varchar("entity_id"),
  entityLabel: text("entity_label"),
  metadataJson: text("metadata_json"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  orgIdx: index("hiring_activity_logs_org_idx").on(table.organizationId),
  activityTypeIdx: index("hiring_activity_logs_activity_type_idx").on(table.activityType),
  createdAtIdx: index("hiring_activity_logs_created_at_idx").on(table.createdAt),
}));

export const insertHiringActivityLogSchema = createInsertSchema(hiringActivityLogs).omit({ id: true, createdAt: true });
export type InsertHiringActivityLog = z.infer<typeof insertHiringActivityLogSchema>;
export type HiringActivityLog = typeof hiringActivityLogs.$inferSelect;

// ==================================================
// TALENT POOL TABLES
// ==================================================

export const talentProfiles = pgTable("talent_profiles", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "set null" }),
  bio: text("bio"),
  tradeSpecialization: text("trade_specialization"),
  yearsOfExperience: integer("years_of_experience"),
  availability: talentAvailabilityEnum("availability").notNull().default("AVAILABLE"),
  visibility: talentProfileVisibilityEnum("visibility").notNull().default("PUBLIC"),
  desiredPayMin: decimal("desired_pay_min", { precision: 10, scale: 2 }),
  desiredPayMax: decimal("desired_pay_max", { precision: 10, scale: 2 }),
  payType: text("pay_type"),
  preferredLocation: text("preferred_location"),
  workRadiusMiles: integer("work_radius_miles"),
  portfolioPhotos: text("portfolio_photos").array().default(sql`'{}'::text[]`),
  resumeUrl: text("resume_url"),
  headline: text("headline"),
  rating: decimal("rating", { precision: 3, scale: 2 }),
  isPublished: boolean("is_published").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  userIdx: index("talent_profiles_user_idx").on(table.userId),
  orgIdx: index("talent_profiles_org_idx").on(table.organizationId),
  tradeIdx: index("talent_profiles_trade_idx").on(table.tradeSpecialization),
  availabilityIdx: index("talent_profiles_availability_idx").on(table.availability),
  publishedIdx: index("talent_profiles_published_idx").on(table.isPublished),
}));

export const insertTalentProfileSchema = createInsertSchema(talentProfiles).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertTalentProfile = z.infer<typeof insertTalentProfileSchema>;
export type TalentProfile = typeof talentProfiles.$inferSelect;

// ==================================================
// HIRING PIPELINE STAGES TABLE
// ==================================================

export const hiringPipelineStages = pgTable("hiring_pipeline_stages", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  key: text("key").notNull(),
  color: text("color").notNull().default("#6b7280"),
  displayOrder: integer("display_order").notNull().default(0),
  isDefault: boolean("is_default").notNull().default(false),
  isTerminal: boolean("is_terminal").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  orgIdx: index("hiring_pipeline_stages_org_idx").on(table.organizationId),
  orderIdx: index("hiring_pipeline_stages_order_idx").on(table.organizationId, table.displayOrder),
}));

export const insertHiringPipelineStageSchema = createInsertSchema(hiringPipelineStages).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertHiringPipelineStage = z.infer<typeof insertHiringPipelineStageSchema>;
export type HiringPipelineStage = typeof hiringPipelineStages.$inferSelect;