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
import { kpiTemplates } from "./kpi";



// ==================== Employee Performance & Rewards System ====================

export const ratingCriteria = pgTable("rating_criteria", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description"),
  weight: decimal("weight", { precision: 5, scale: 2 }).default("1.0"),
  maxScore: integer("max_score").notNull().default(10),
  isActive: boolean("is_active").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
  kpiTemplateId: varchar("kpi_template_id").references(() => kpiTemplates.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  orgIdx: index("rating_criteria_org_idx").on(table.organizationId),
  orgNameUnique: unique("rating_criteria_org_name_unique").on(table.organizationId, table.name),
}));

export const employeeRatings = pgTable("employee_ratings", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  employeeId: varchar("employee_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  evaluatorId: varchar("evaluator_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  projectId: varchar("project_id").references(() => projects.id, { onDelete: "set null" }),
  period: text("period"),
  overallScore: decimal("overall_score", { precision: 5, scale: 2 }),
  weightedScore: decimal("weighted_score", { precision: 5, scale: 2 }),
  comments: text("comments"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  orgIdx: index("employee_ratings_org_idx").on(table.organizationId),
  employeeIdx: index("employee_ratings_employee_idx").on(table.employeeId),
  evaluatorIdx: index("employee_ratings_evaluator_idx").on(table.evaluatorId),
}));

export const ratingScores = pgTable("rating_scores", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  ratingId: varchar("rating_id").notNull().references(() => employeeRatings.id, { onDelete: "cascade" }),
  criteriaId: varchar("criteria_id").notNull().references(() => ratingCriteria.id, { onDelete: "cascade" }),
  score: decimal("score", { precision: 5, scale: 2 }).notNull(),
  comment: text("comment"),
}, (table) => ({
  ratingIdx: index("rating_scores_rating_idx").on(table.ratingId),
  ratingCriteriaUnique: unique("rating_scores_rating_criteria_unique").on(table.ratingId, table.criteriaId),
}));

export const rewardTypes = pgTable("reward_types", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description"),
  category: rewardTypeEnum("category").notNull().default("CUSTOM"),
  value: decimal("value", { precision: 10, scale: 2 }),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  orgIdx: index("reward_types_org_idx").on(table.organizationId),
  orgNameUnique: unique("reward_types_org_name_unique").on(table.organizationId, table.name),
}));

export const rewardAssignments = pgTable("reward_assignments", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  employeeId: varchar("employee_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  rewardTypeId: varchar("reward_type_id").notNull().references(() => rewardTypes.id, { onDelete: "cascade" }),
  assignedById: varchar("assigned_by_id").notNull().references(() => users.id),
  ratingId: varchar("rating_id").references(() => employeeRatings.id, { onDelete: "set null" }),
  amount: decimal("amount", { precision: 10, scale: 2 }),
  justification: text("justification"),
  expiresAt: timestamp("expires_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  orgIdx: index("reward_assignments_org_idx").on(table.organizationId),
  employeeIdx: index("reward_assignments_employee_idx").on(table.employeeId),
}));

export const insertRatingCriteriaSchema = createInsertSchema(ratingCriteria).omit({ id: true, createdAt: true });
export type InsertRatingCriteria = z.infer<typeof insertRatingCriteriaSchema>;
export type RatingCriteria = typeof ratingCriteria.$inferSelect;

export const insertEmployeeRatingSchema = createInsertSchema(employeeRatings).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertEmployeeRating = z.infer<typeof insertEmployeeRatingSchema>;
export type EmployeeRating = typeof employeeRatings.$inferSelect;

export const insertRatingScoreSchema = createInsertSchema(ratingScores).omit({ id: true });
export type InsertRatingScore = z.infer<typeof insertRatingScoreSchema>;
export type RatingScore = typeof ratingScores.$inferSelect;

export const insertRewardTypeSchema = createInsertSchema(rewardTypes).omit({ id: true, createdAt: true });
export type InsertRewardType = z.infer<typeof insertRewardTypeSchema>;
export type RewardType = typeof rewardTypes.$inferSelect;

export const insertRewardAssignmentSchema = createInsertSchema(rewardAssignments).omit({ id: true, createdAt: true });
export type InsertRewardAssignment = z.infer<typeof insertRewardAssignmentSchema>;
export type RewardAssignment = typeof rewardAssignments.$inferSelect;

// ==================== Performance & History System ====================

export const employeePerformanceProfiles = pgTable("employee_performance_profiles", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  experienceLevel: text("experience_level"),
  productivityTendencies: text("productivity_tendencies"),
  pastProjects: text("past_projects"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertEmployeePerformanceProfileSchema = createInsertSchema(employeePerformanceProfiles).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertEmployeePerformanceProfile = z.infer<typeof insertEmployeePerformanceProfileSchema>;
export type EmployeePerformanceProfile = typeof employeePerformanceProfiles.$inferSelect;

export const attendanceLogs = pgTable("attendance_logs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  date: text("date").notNull(),
  status: text("status").notNull(),
  notes: text("notes"),
  recordedBy: varchar("recorded_by").references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertAttendanceLogSchema = createInsertSchema(attendanceLogs).omit({ id: true, createdAt: true });
export type InsertAttendanceLog = z.infer<typeof insertAttendanceLogSchema>;
export type AttendanceLog = typeof attendanceLogs.$inferSelect;

export const performanceReviews = pgTable("performance_reviews", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  reviewDate: text("review_date").notNull(),
  reviewerName: text("reviewer_name").notNull(),
  overallRating: integer("overall_rating").notNull(),
  productivityRating: integer("productivity_rating"),
  qualityRating: integer("quality_rating"),
  safetyRating: integer("safety_rating"),
  communicationRating: integer("communication_rating"),
  leadershipRating: integer("leadership_rating"),
  notes: text("notes"),
  scheduleAdherence: text("schedule_adherence"),
  costControl: text("cost_control"),
  subcontractorCoordination: text("subcontractor_coordination"),
  clientInspectionOutcomes: text("client_inspection_outcomes"),
  recordedBy: varchar("recorded_by").references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertPerformanceReviewSchema = createInsertSchema(performanceReviews).omit({ id: true, createdAt: true });
export type InsertPerformanceReview = z.infer<typeof insertPerformanceReviewSchema>;
export type PerformanceReview = typeof performanceReviews.$inferSelect;

export const peerRatings = pgTable("peer_ratings", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  raterId: varchar("rater_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  rateeId: varchar("ratee_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  projectId: varchar("project_id").references(() => projects.id, { onDelete: "set null" }),
  crewId: varchar("crew_id").references(() => crews.id, { onDelete: "set null" }),
  period: text("period").notNull(),
  teamwork: integer("teamwork").notNull(),
  reliability: integer("reliability").notNull(),
  communication: integer("communication").notNull(),
  helpfulness: integer("helpfulness").notNull(),
  comment: text("comment"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  orgIdx: index("peer_ratings_org_idx").on(table.organizationId),
  rateeIdx: index("peer_ratings_ratee_idx").on(table.rateeId),
  raterIdx: index("peer_ratings_rater_idx").on(table.raterId),
  // uniqueRating enforced via raw SQL index peer_ratings_unique_v3:
  // UNIQUE(organization_id, rater_id, ratee_id, COALESCE(project_id, ''), period)
}));

export const insertPeerRatingSchema = createInsertSchema(peerRatings).omit({ id: true, createdAt: true });
export type InsertPeerRating = z.infer<typeof insertPeerRatingSchema>;
export type PeerRating = typeof peerRatings.$inferSelect;

export const supervisorNotes = pgTable("supervisor_notes", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  note: text("note").notNull(),
  createdBy: varchar("created_by").references(() => users.id),
  createdByName: text("created_by_name").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertSupervisorNoteSchema = createInsertSchema(supervisorNotes).omit({ id: true, createdAt: true });
export type InsertSupervisorNote = z.infer<typeof insertSupervisorNoteSchema>;
export type SupervisorNote = typeof supervisorNotes.$inferSelect;

export const workerLogs = pgTable("worker_logs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  date: text("date").notNull(),
  note: text("note").notNull(),
  category: text("category").notNull().default("GENERAL"),
  createdBy: varchar("created_by").references(() => users.id),
  createdByName: text("created_by_name").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertWorkerLogSchema = createInsertSchema(workerLogs).omit({ id: true, createdAt: true });
export type InsertWorkerLog = z.infer<typeof insertWorkerLogSchema>;
export type WorkerLog = typeof workerLogs.$inferSelect;