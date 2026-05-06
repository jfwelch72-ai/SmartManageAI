// AUTO-GENERATED SPLIT FROM shared/schema/features.ts (Task #2426).
// Domain bucketing rule lives in shared/schema/features/index.ts.
import { sql } from "drizzle-orm";
import { pgTable, text, varchar, boolean, timestamp, date, decimal, integer, pgEnum, doublePrecision, index, unique, uniqueIndex, json, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod";
import { addendumRecipientTypeEnum, addendumStatusEnum, aiBidDocumentAnalysisStatusEnum, aiCoDraftStatusEnum, aiContractDocumentAnalysisStatusEnum, contractStatusEnum, contractTypeEnum, contractRedlineStatusEnum, contractApprovalDecisionEnum, clauseCategoryEnum, signatureRequestStatusEnum, signerStatusEnum, aiInsightModuleEnum, aiInsightSeverityEnum, aiTakeoffModeEnum, aiTakeoffStatusEnum, aiTakeoffSuggestionStatusEnum, aiTakeoffRejectReasonEnum, aiTaskPriorityEnum, aiTaskStatusEnum, approvalEntityTypeEnum, approvalStatusEnum, atsProviderEnum, bidEquipmentSourceEnum, bidInvitationStatusEnum, bidRequestStatusEnum, bidResponseStatusEnum, blogCommentStatusEnum, blogPostStatusEnum, conversationTypeEnum, crewAvailabilityStatusEnum, crmActivityTypeEnum, crmCallDirectionEnum, crmCallOutcomeEnum, crmCallStatusEnum, crmCustomFieldEntityEnum, crmCustomFieldTypeEnum, crmContactRoleEnum, crmNoteTypeEnum, crmOrgStatusEnum, crmOrganisationTypeEnum, crmPipelineStageEnum, crmPreferredContactEnum, crmLostCategoryEnum, crmQuoteAcceptanceStatusEnum, crmLeadScoringOperatorEnum, crmSequenceStatusEnum, crmSequenceStepTypeEnum, crmSequenceEnrollmentStatusEnum, crmSequenceExecutionStatusEnum, crmSequenceEmailEventTypeEnum, crmSequenceExitReasonEnum, crmQuoteApprovalStatusEnum, dataSubjectRequestStatusEnum, dataSubjectRequestTypeEnum, documentRevisionSourceEnum, documentRevisionStatusEnum, emailClassificationEnum, emailProviderEnum, emailTaskSourceEnum, emailThreadStatusEnum, hiringActivityTypeEnum, hiringCandidateStageEnum, hiringCompensationTypeEnum, hiringEmploymentTypeEnum, hiringInterviewStatusEnum, hiringJobStatusEnum, hiringSyncStatusEnum, hustlerDelegateRoleEnum, hustlerLinkRequestStatusEnum, installationStatusEnum, lidarScanStatusEnum, lidarAnnotationTypeEnum, lidarComparisonTypeEnum, unifiedPaymentMethodEnum, unifiedPaymentStatusEnum, invoiceTypeEnum, integrationConnectionStatusEnum, integrationEventStatusEnum, integrationProviderEnum, issueSeverityEnum, issueStatusEnum, jobsiteAnalysisStatusEnum, lienWaiverStatusEnum, lienWaiverTypeEnum, locationLevelEnum, maintenanceTypeEnum, measurementReviewStatusEnum, measurementSourceEnum, measurementStatusEnum, measurementTypeEnum, takeoffVersionStatusEnum, messageEntityTypeEnum, mobilePlatformEnum, offlineEntityTypeEnum, offlineOperationTypeEnum, offlineSyncStatusEnum, organizationDocumentTypeEnum, organizationDocumentVisibilityEnum, overheadCostActionEnum, overheadCostCategoryEnum, overheadCostFrequencyEnum, portalChatPriorityEnum, portalChatThreadCategoryEnum, portalChatThreadStatusEnum, pricebookImportJobStatusEnum, pricebookStatusEnum, pricingApprovalStatusEnum, pricingSourceTypeEnum, projectEquipmentPlanStatusEnum, repairStatusEnum, retentionActionEnum, retentionEntityTypeEnum, rewardTypeEnum, rfiCategoryEnum, rfiPriorityEnum, rfiStatusEnum, scheduleDependencyTypeEnum, scheduleGeneratedByEnum, scheduleTaskStatusEnum, socialAccountStatusEnum, socialPlatformEnum, socialPostStatusEnum, sovPaymentMethodEnum, sovStatusEnum, storedMaterialStatusEnum, retentionReleaseTypeEnum, retentionReleaseStatusEnum, sowAuditActionEnum, ssoProviderEnum, submittalCategoryEnum, submittalItemStatusEnum, submittalPhaseEnum, submittalReviewRoleEnum, submittalReviewStatusEnum, submittalStatusEnum, submittalTypeEnum, syncStatusEnum, tradeTypeEnum, transmittalStatusEnum, userRoleEnum, vendorEnrollmentStatusEnum, voiceLogStatusEnum, websiteDeploymentActionEnum, websitePageTypeEnum, websiteProjectStatusEnum, websiteStatusEnum, takeoffIssueCategoryEnum, takeoffIssueStatusEnum, talentAvailabilityEnum, talentProfileVisibilityEnum, workflowEntityTypeEnum, riskCategoryEnum, riskStatusEnum, workflowTemplateStatusEnum, workflowInstanceStatusEnum, videoCallStatusEnum, workflowNotificationChannelEnum, dotAgencyKindEnum, dotPayItemTypeEnum, dbeCertificationTypeEnum, suretyBondTypeEnum, suretyBondStatusEnum, haulTicketStatusEnum, swpppInspectionTypeEnum, idrStatusEnum, buyAmericaStatusEnum } from "../enums";
import { bids, organizations, projects, users } from "../core";
import { changeOrders, estimateLineItems, estimates, planDocuments, projectInspections, tasks, tmTickets } from "../operations";



// Estimate Settings table (global cost settings and rates)
export const estimateSettings = pgTable("estimate_settings", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  defaultMaterialPrices: text("default_material_prices").notNull().default('{}'),
  defaultLaborRates: text("default_labor_rates").notNull().default('{}'),
  defaultEquipmentRates: text("default_equipment_rates").notNull().default('{}'),
  defaultProductionRates: text("default_production_rates").notNull().default('{}'),
  defaultOverheadPercent: doublePrecision("default_overhead_percent").notNull().default(15),
  defaultProfitMarginPercent: doublePrecision("default_profit_margin_percent").notNull().default(20),
  defaultMarkups: text("default_markups").notNull().default('{}'),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Estimate Crews table (crew definitions and production rates)
export const estimateCrews = pgTable("estimate_crews", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  description: text("description"),
  members: text("members").notNull().default('[]'),
  blendedRatePerHour: decimal("blended_rate_per_hour", { precision: 10, scale: 2 }).notNull(),
  productionRateMapping: text("production_rate_mapping").notNull().default('{}'),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Stone type enum for sub-base calculations
export const estimateVersions = pgTable("estimate_versions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  estimateId: varchar("estimate_id").notNull().references(() => estimates.id, { onDelete: "cascade" }),
  versionNumber: integer("version_number").notNull(),
  snapshot: text("snapshot").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  estimateIdx: index("estimate_versions_estimate_idx").on(table.estimateId),
}));

// Estimate Vendor Quotes table (uploaded vendor/material quotes)
export const estimateVendorQuotes = pgTable("estimate_vendor_quotes", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  estimateId: varchar("estimate_id").notNull().references(() => estimates.id, { onDelete: "cascade" }),
  vendorName: text("vendor_name").notNull(),
  contactInfo: text("contact_info"),
  scopeDescription: text("scope_description").notNull(),
  quoteAmount: decimal("quote_amount", { precision: 12, scale: 2 }).notNull(),
  fileUrl: text("file_url"),
  fileName: text("file_name"),
  fileSize: integer("file_size"),
  mimeType: text("mime_type"),
  linkedLineItemIds: text("linked_line_item_ids").notNull().default('[]'),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  estimateIdx: index("estimate_vendor_quotes_estimate_idx").on(table.estimateId),
}));

// Estimate History table (for production rate tracking)
export const estimateHistory = pgTable("estimate_history", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  estimateId: varchar("estimate_id").references(() => estimates.id, { onDelete: "cascade" }),
  data: text("data").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertEstimateSettingsSchema = createInsertSchema(estimateSettings).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertEstimateSettings = z.infer<typeof insertEstimateSettingsSchema>;
export type EstimateSettings = typeof estimateSettings.$inferSelect;

export const insertEstimateCrewSchema = createInsertSchema(estimateCrews).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertEstimateCrew = z.infer<typeof insertEstimateCrewSchema>;
export type EstimateCrew = typeof estimateCrews.$inferSelect;

export const insertEstimateVersionSchema = createInsertSchema(estimateVersions).omit({ id: true, createdAt: true });
export type InsertEstimateVersion = z.infer<typeof insertEstimateVersionSchema>;
export type EstimateVersion = typeof estimateVersions.$inferSelect;

export const insertEstimateVendorQuoteSchema = createInsertSchema(estimateVendorQuotes).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertEstimateVendorQuote = z.infer<typeof insertEstimateVendorQuoteSchema>;
export type EstimateVendorQuote = typeof estimateVendorQuotes.$inferSelect;

export const insertEstimateHistorySchema = createInsertSchema(estimateHistory).omit({ id: true, createdAt: true });
export type InsertEstimateHistory = z.infer<typeof insertEstimateHistorySchema>;
export type EstimateHistory = typeof estimateHistory.$inferSelect;