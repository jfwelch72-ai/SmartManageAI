// AUTO-GENERATED SPLIT FROM shared/schema/features.ts (Task #2426).
// Domain bucketing rule lives in shared/schema/features/index.ts.
import { sql } from "drizzle-orm";
import { pgTable, text, varchar, boolean, timestamp, date, decimal, integer, pgEnum, doublePrecision, index, unique, uniqueIndex, json, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod";
import { addendumRecipientTypeEnum, addendumStatusEnum, aiBidDocumentAnalysisStatusEnum, aiCoDraftStatusEnum, aiContractDocumentAnalysisStatusEnum, contractStatusEnum, contractTypeEnum, contractRedlineStatusEnum, contractApprovalDecisionEnum, clauseCategoryEnum, signatureRequestStatusEnum, signerStatusEnum, aiInsightModuleEnum, aiInsightSeverityEnum, aiTakeoffModeEnum, aiTakeoffStatusEnum, aiTakeoffSuggestionStatusEnum, aiTakeoffRejectReasonEnum, aiTaskPriorityEnum, aiTaskStatusEnum, approvalEntityTypeEnum, approvalStatusEnum, atsProviderEnum, bidEquipmentSourceEnum, bidInvitationStatusEnum, bidRequestStatusEnum, bidResponseStatusEnum, blogCommentStatusEnum, blogPostStatusEnum, conversationTypeEnum, crewAvailabilityStatusEnum, crmActivityTypeEnum, crmCallDirectionEnum, crmCallOutcomeEnum, crmCallStatusEnum, crmCustomFieldEntityEnum, crmCustomFieldTypeEnum, crmContactRoleEnum, crmNoteTypeEnum, crmOrgStatusEnum, crmOrganisationTypeEnum, crmPipelineStageEnum, crmPreferredContactEnum, crmLostCategoryEnum, crmQuoteAcceptanceStatusEnum, crmLeadScoringOperatorEnum, crmSequenceStatusEnum, crmSequenceStepTypeEnum, crmSequenceEnrollmentStatusEnum, crmSequenceExecutionStatusEnum, crmSequenceEmailEventTypeEnum, crmSequenceExitReasonEnum, crmQuoteApprovalStatusEnum, dataSubjectRequestStatusEnum, dataSubjectRequestTypeEnum, documentRevisionSourceEnum, documentRevisionStatusEnum, emailClassificationEnum, emailProviderEnum, emailTaskSourceEnum, emailThreadStatusEnum, hiringActivityTypeEnum, hiringCandidateStageEnum, hiringCompensationTypeEnum, hiringEmploymentTypeEnum, hiringInterviewStatusEnum, hiringJobStatusEnum, hiringSyncStatusEnum, hustlerDelegateRoleEnum, hustlerLinkRequestStatusEnum, installationStatusEnum, lidarScanStatusEnum, lidarAnnotationTypeEnum, lidarComparisonTypeEnum, unifiedPaymentMethodEnum, unifiedPaymentStatusEnum, invoiceTypeEnum, integrationConnectionStatusEnum, integrationEventStatusEnum, integrationProviderEnum, issueSeverityEnum, issueStatusEnum, jobsiteAnalysisStatusEnum, lienWaiverStatusEnum, lienWaiverTypeEnum, locationLevelEnum, maintenanceTypeEnum, measurementReviewStatusEnum, measurementSourceEnum, measurementStatusEnum, measurementTypeEnum, takeoffVersionStatusEnum, messageEntityTypeEnum, mobilePlatformEnum, offlineEntityTypeEnum, offlineOperationTypeEnum, offlineSyncStatusEnum, organizationDocumentTypeEnum, organizationDocumentVisibilityEnum, overheadCostActionEnum, overheadCostCategoryEnum, overheadCostFrequencyEnum, portalChatPriorityEnum, portalChatThreadCategoryEnum, portalChatThreadStatusEnum, pricebookImportJobStatusEnum, pricebookStatusEnum, pricingApprovalStatusEnum, pricingSourceTypeEnum, projectEquipmentPlanStatusEnum, repairStatusEnum, retentionActionEnum, retentionEntityTypeEnum, rewardTypeEnum, rfiCategoryEnum, rfiPriorityEnum, rfiStatusEnum, scheduleDependencyTypeEnum, scheduleGeneratedByEnum, scheduleTaskStatusEnum, socialAccountStatusEnum, socialPlatformEnum, socialPostStatusEnum, sovPaymentMethodEnum, sovStatusEnum, storedMaterialStatusEnum, retentionReleaseTypeEnum, retentionReleaseStatusEnum, sowAuditActionEnum, ssoProviderEnum, submittalCategoryEnum, submittalItemStatusEnum, submittalPhaseEnum, submittalReviewRoleEnum, submittalReviewStatusEnum, submittalStatusEnum, submittalTypeEnum, syncStatusEnum, tradeTypeEnum, transmittalStatusEnum, userRoleEnum, vendorEnrollmentStatusEnum, voiceLogStatusEnum, websiteDeploymentActionEnum, websitePageTypeEnum, websiteProjectStatusEnum, websiteStatusEnum, takeoffIssueCategoryEnum, takeoffIssueStatusEnum, talentAvailabilityEnum, talentProfileVisibilityEnum, workflowEntityTypeEnum, riskCategoryEnum, riskStatusEnum, workflowTemplateStatusEnum, workflowInstanceStatusEnum, videoCallStatusEnum, workflowNotificationChannelEnum, dotAgencyKindEnum, dotPayItemTypeEnum, dbeCertificationTypeEnum, suretyBondTypeEnum, suretyBondStatusEnum, haulTicketStatusEnum, swpppInspectionTypeEnum, idrStatusEnum, buyAmericaStatusEnum } from "../enums";
import { bids, organizations, projects, users } from "../core";
import { changeOrders, estimateLineItems, estimates, planDocuments, projectInspections, tasks, tmTickets } from "../operations";



export const contracts = pgTable("contracts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  bidId: varchar("bid_id").references(() => bids.id, { onDelete: "set null" }),
  contractNumber: text("contract_number").notNull(),
  contractType: contractTypeEnum("contract_type").notNull().default("PRIME"),
  status: contractStatusEnum("status").notNull().default("DRAFT"),
  parties: text("parties"),
  contractValue: decimal("contract_value", { precision: 14, scale: 2 }),
  effectiveDate: timestamp("effective_date"),
  expirationDate: timestamp("expiration_date"),
  paymentTerms: text("payment_terms"),
  retentionPercent: decimal("retention_percent", { precision: 5, scale: 2 }),
  insuranceRequirements: text("insurance_requirements"),
  scopeSummary: text("scope_summary"),
  keyDates: text("key_dates"),
  signatureDate: timestamp("signature_date"),
  signatoryNames: text("signatory_names"),
  executedDocumentUrl: text("executed_document_url"),
  attachmentsJson: text("attachments_json"),
  currentVersion: integer("current_version").notNull().default(1),
  createdById: varchar("created_by_id").notNull().references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  orgIdx: index("contracts_org_idx").on(table.organizationId),
  projectIdx: index("contracts_project_idx").on(table.projectId),
  statusIdx: index("contracts_status_idx").on(table.status),
}));

export const insertContractSchema = createInsertSchema(contracts).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertContract = z.infer<typeof insertContractSchema>;
export type Contract = typeof contracts.$inferSelect;

export const contractVersions = pgTable("contract_versions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  contractId: varchar("contract_id").notNull().references(() => contracts.id, { onDelete: "cascade" }),
  versionNumber: integer("version_number").notNull(),
  snapshotJson: text("snapshot_json").notNull(),
  attachmentsJson: text("attachments_json"),
  changedById: varchar("changed_by_id").notNull().references(() => users.id),
  changeNote: text("change_note"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  contractIdx: index("contract_versions_contract_idx").on(table.contractId),
  versionIdx: index("contract_versions_version_idx").on(table.contractId, table.versionNumber),
}));

export const insertContractVersionSchema = createInsertSchema(contractVersions).omit({ id: true, createdAt: true });
export type InsertContractVersion = z.infer<typeof insertContractVersionSchema>;
export type ContractVersion = typeof contractVersions.$inferSelect;

export const contractRedlines = pgTable("contract_redlines", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  contractId: varchar("contract_id").notNull().references(() => contracts.id, { onDelete: "cascade" }),
  requestedById: varchar("requested_by_id").notNull().references(() => users.id),
  description: text("description").notNull(),
  section: text("section"),
  status: contractRedlineStatusEnum("status").notNull().default("OPEN"),
  resolution: text("resolution"),
  resolvedById: varchar("resolved_by_id").references(() => users.id),
  resolvedAt: timestamp("resolved_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  contractIdx: index("contract_redlines_contract_idx").on(table.contractId),
  statusIdx: index("contract_redlines_status_idx").on(table.status),
}));

export const insertContractRedlineSchema = createInsertSchema(contractRedlines).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertContractRedline = z.infer<typeof insertContractRedlineSchema>;
export type ContractRedline = typeof contractRedlines.$inferSelect;

export const contractApprovals = pgTable("contract_approvals", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  contractId: varchar("contract_id").notNull().references(() => contracts.id, { onDelete: "cascade" }),
  reviewerId: varchar("reviewer_id").notNull().references(() => users.id),
  decision: contractApprovalDecisionEnum("decision").notNull().default("PENDING"),
  comments: text("comments"),
  decidedAt: timestamp("decided_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  contractIdx: index("contract_approvals_contract_idx").on(table.contractId),
  reviewerIdx: index("contract_approvals_reviewer_idx").on(table.reviewerId),
}));

export const insertContractApprovalSchema = createInsertSchema(contractApprovals).omit({ id: true, createdAt: true });
export type InsertContractApproval = z.infer<typeof insertContractApprovalSchema>;
export type ContractApproval = typeof contractApprovals.$inferSelect;

export const contractClauses = pgTable("contract_clauses", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  category: clauseCategoryEnum("category").notNull(),
  content: text("content").notNull(),
  isRequired: boolean("is_required").notNull().default(false),
  isDefault: boolean("is_default").notNull().default(false),
  sortOrder: integer("sort_order").notNull().default(0),
  createdById: varchar("created_by_id").notNull().references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  orgIdx: index("contract_clauses_org_idx").on(table.organizationId),
  categoryIdx: index("contract_clauses_category_idx").on(table.category),
}));

export const insertContractClauseSchema = createInsertSchema(contractClauses).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertContractClause = z.infer<typeof insertContractClauseSchema>;
export type ContractClause = typeof contractClauses.$inferSelect;

export const contractTemplates = pgTable("contract_templates", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description"),
  contractType: contractTypeEnum("contract_type").notNull().default("PRIME"),
  clauseIdsJson: text("clause_ids_json").notNull().default("[]"),
  defaultPaymentTerms: text("default_payment_terms"),
  defaultRetentionPercent: decimal("default_retention_percent", { precision: 5, scale: 2 }),
  defaultInsuranceRequirements: text("default_insurance_requirements"),
  isActive: boolean("is_active").notNull().default(true),
  createdById: varchar("created_by_id").notNull().references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  orgIdx: index("contract_templates_org_idx").on(table.organizationId),
}));

export const insertContractTemplateSchema = createInsertSchema(contractTemplates).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertContractTemplate = z.infer<typeof insertContractTemplateSchema>;
export type ContractTemplate = typeof contractTemplates.$inferSelect;

export const signatureRequests = pgTable("signature_requests", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  contractId: varchar("contract_id").notNull().references(() => contracts.id, { onDelete: "cascade" }),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  status: signatureRequestStatusEnum("status").notNull().default("PENDING"),
  signersJson: text("signers_json").notNull().default("[]"),
  message: text("message"),
  expiresAt: timestamp("expires_at"),
  completedAt: timestamp("completed_at"),
  createdById: varchar("created_by_id").notNull().references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  contractIdx: index("signature_requests_contract_idx").on(table.contractId),
  orgIdx: index("signature_requests_org_idx").on(table.organizationId),
  statusIdx: index("signature_requests_status_idx").on(table.status),
}));

export const insertSignatureRequestSchema = createInsertSchema(signatureRequests).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertSignatureRequest = z.infer<typeof insertSignatureRequestSchema>;
export type SignatureRequest = typeof signatureRequests.$inferSelect;

export const contractRiskAnalyses = pgTable("contract_risk_analyses", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  contractId: varchar("contract_id").notNull().references(() => contracts.id, { onDelete: "cascade" }),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  overallRiskScore: integer("overall_risk_score").notNull(),
  riskLevel: text("risk_level").notNull(),
  summaryText: text("summary_text").notNull(),
  clauseAnalysisJson: text("clause_analysis_json").notNull().default("[]"),
  missingProtectionsJson: text("missing_protections_json").notNull().default("[]"),
  recommendationsJson: text("recommendations_json").notNull().default("[]"),
  analyzedById: varchar("analyzed_by_id").notNull().references(() => users.id),
  analyzedAt: timestamp("analyzed_at").notNull().defaultNow(),
}, (table) => ({
  contractIdx: index("contract_risk_analyses_contract_idx").on(table.contractId),
  orgIdx: index("contract_risk_analyses_org_idx").on(table.organizationId),
}));

export type ContractRiskAnalysis = typeof contractRiskAnalyses.$inferSelect;