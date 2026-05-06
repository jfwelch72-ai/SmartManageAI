// AUTO-GENERATED SPLIT FROM shared/schema/features.ts (Task #2426).
// Domain bucketing rule lives in shared/schema/features/index.ts.
import { sql } from "drizzle-orm";
import { pgTable, text, varchar, boolean, timestamp, date, decimal, integer, pgEnum, doublePrecision, index, unique, uniqueIndex, json, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod";
import { addendumRecipientTypeEnum, addendumStatusEnum, aiBidDocumentAnalysisStatusEnum, aiCoDraftStatusEnum, aiContractDocumentAnalysisStatusEnum, contractStatusEnum, contractTypeEnum, contractRedlineStatusEnum, contractApprovalDecisionEnum, clauseCategoryEnum, signatureRequestStatusEnum, signerStatusEnum, aiInsightModuleEnum, aiInsightSeverityEnum, aiTakeoffModeEnum, aiTakeoffStatusEnum, aiTakeoffSuggestionStatusEnum, aiTakeoffRejectReasonEnum, aiTaskPriorityEnum, aiTaskStatusEnum, approvalEntityTypeEnum, approvalStatusEnum, atsProviderEnum, bidEquipmentSourceEnum, bidInvitationStatusEnum, bidRequestStatusEnum, bidResponseStatusEnum, blogCommentStatusEnum, blogPostStatusEnum, conversationTypeEnum, crewAvailabilityStatusEnum, crmActivityTypeEnum, crmCallDirectionEnum, crmCallOutcomeEnum, crmCallStatusEnum, crmCustomFieldEntityEnum, crmCustomFieldTypeEnum, crmContactRoleEnum, crmNoteTypeEnum, crmOrgStatusEnum, crmOrganisationTypeEnum, crmPipelineStageEnum, crmPreferredContactEnum, crmLostCategoryEnum, crmQuoteAcceptanceStatusEnum, crmLeadScoringOperatorEnum, crmSequenceStatusEnum, crmSequenceStepTypeEnum, crmSequenceEnrollmentStatusEnum, crmSequenceExecutionStatusEnum, crmSequenceEmailEventTypeEnum, crmSequenceExitReasonEnum, crmQuoteApprovalStatusEnum, dataSubjectRequestStatusEnum, dataSubjectRequestTypeEnum, documentRevisionSourceEnum, documentRevisionStatusEnum, emailClassificationEnum, emailProviderEnum, emailTaskSourceEnum, emailThreadStatusEnum, hiringActivityTypeEnum, hiringCandidateStageEnum, hiringCompensationTypeEnum, hiringEmploymentTypeEnum, hiringInterviewStatusEnum, hiringJobStatusEnum, hiringSyncStatusEnum, hustlerDelegateRoleEnum, hustlerLinkRequestStatusEnum, installationStatusEnum, lidarScanStatusEnum, lidarAnnotationTypeEnum, lidarComparisonTypeEnum, unifiedPaymentMethodEnum, unifiedPaymentStatusEnum, invoiceTypeEnum, integrationConnectionStatusEnum, integrationEventStatusEnum, integrationProviderEnum, issueSeverityEnum, issueStatusEnum, jobsiteAnalysisStatusEnum, lienWaiverStatusEnum, lienWaiverTypeEnum, locationLevelEnum, maintenanceTypeEnum, measurementReviewStatusEnum, measurementSourceEnum, measurementStatusEnum, measurementTypeEnum, takeoffVersionStatusEnum, messageEntityTypeEnum, mobilePlatformEnum, offlineEntityTypeEnum, offlineOperationTypeEnum, offlineSyncStatusEnum, organizationDocumentTypeEnum, organizationDocumentVisibilityEnum, overheadCostActionEnum, overheadCostCategoryEnum, overheadCostFrequencyEnum, portalChatPriorityEnum, portalChatThreadCategoryEnum, portalChatThreadStatusEnum, pricebookImportJobStatusEnum, pricebookStatusEnum, pricingApprovalStatusEnum, pricingSourceTypeEnum, projectEquipmentPlanStatusEnum, repairStatusEnum, retentionActionEnum, retentionEntityTypeEnum, rewardTypeEnum, rfiCategoryEnum, rfiPriorityEnum, rfiStatusEnum, scheduleDependencyTypeEnum, scheduleGeneratedByEnum, scheduleTaskStatusEnum, socialAccountStatusEnum, socialPlatformEnum, socialPostStatusEnum, sovPaymentMethodEnum, sovStatusEnum, storedMaterialStatusEnum, retentionReleaseTypeEnum, retentionReleaseStatusEnum, sowAuditActionEnum, ssoProviderEnum, submittalCategoryEnum, submittalItemStatusEnum, submittalPhaseEnum, submittalReviewRoleEnum, submittalReviewStatusEnum, submittalStatusEnum, submittalTypeEnum, syncStatusEnum, tradeTypeEnum, transmittalStatusEnum, userRoleEnum, vendorEnrollmentStatusEnum, voiceLogStatusEnum, websiteDeploymentActionEnum, websitePageTypeEnum, websiteProjectStatusEnum, websiteStatusEnum, takeoffIssueCategoryEnum, takeoffIssueStatusEnum, talentAvailabilityEnum, talentProfileVisibilityEnum, workflowEntityTypeEnum, riskCategoryEnum, riskStatusEnum, workflowTemplateStatusEnum, workflowInstanceStatusEnum, videoCallStatusEnum, workflowNotificationChannelEnum, dotAgencyKindEnum, dotPayItemTypeEnum, dbeCertificationTypeEnum, suretyBondTypeEnum, suretyBondStatusEnum, haulTicketStatusEnum, swpppInspectionTypeEnum, idrStatusEnum, buyAmericaStatusEnum } from "../enums";
import { bids, organizations, projects, users } from "../core";
import { changeOrders, estimateLineItems, estimates, planDocuments, projectInspections, tasks, tmTickets } from "../operations";



// ============================================================================
// Custom KPI Management System
// ============================================================================

export const kpiTemplates = pgTable("kpi_templates", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description"),
  category: text("category").notNull().default("Custom"),
  unit: text("unit").notNull().default("count"),
  direction: text("direction").notNull().default("higher_is_better"),
  isActive: boolean("is_active").notNull().default(true),
  createdBy: varchar("created_by").references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  orgIdx: index("kpi_templates_org_idx").on(table.organizationId),
}));

export const insertKpiTemplateSchema = createInsertSchema(kpiTemplates).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertKpiTemplate = z.infer<typeof insertKpiTemplateSchema>;
export type KpiTemplate = typeof kpiTemplates.$inferSelect;

export const kpiAssignments = pgTable("kpi_assignments", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  kpiTemplateId: varchar("kpi_template_id").notNull().references(() => kpiTemplates.id, { onDelete: "cascade" }),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  targetValue: decimal("target_value", { precision: 12, scale: 2 }).notNull(),
  periodType: text("period_type").notNull().default("monthly"),
  startDate: date("start_date").notNull(),
  endDate: date("end_date"),
  isActive: boolean("is_active").notNull().default(true),
  assignedBy: varchar("assigned_by").references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  orgIdx: index("kpi_assignments_org_idx").on(table.organizationId),
  userIdx: index("kpi_assignments_user_idx").on(table.userId),
  templateIdx: index("kpi_assignments_template_idx").on(table.kpiTemplateId),
}));

export const insertKpiAssignmentSchema = createInsertSchema(kpiAssignments).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertKpiAssignment = z.infer<typeof insertKpiAssignmentSchema>;
export type KpiAssignment = typeof kpiAssignments.$inferSelect;

export const kpiEntries = pgTable("kpi_entries", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  kpiAssignmentId: varchar("kpi_assignment_id").notNull().references(() => kpiAssignments.id, { onDelete: "cascade" }),
  actualValue: decimal("actual_value", { precision: 12, scale: 2 }).notNull(),
  periodStart: date("period_start").notNull(),
  periodEnd: date("period_end").notNull(),
  notes: text("notes"),
  source: varchar("source", { length: 10 }).notNull().default("manual"),
  recordedBy: varchar("recorded_by").references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  orgIdx: index("kpi_entries_org_idx").on(table.organizationId),
  assignmentIdx: index("kpi_entries_assignment_idx").on(table.kpiAssignmentId),
  periodIdx: index("kpi_entries_period_idx").on(table.periodStart, table.periodEnd),
}));

export const insertKpiEntrySchema = createInsertSchema(kpiEntries).omit({ id: true, createdAt: true });
export type InsertKpiEntry = z.infer<typeof insertKpiEntrySchema>;
export type KpiEntry = typeof kpiEntries.$inferSelect;