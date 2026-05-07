// AUTO-GENERATED SPLIT FROM shared/schema/features.ts (Task #2426).
// Domain bucketing rule lives in shared/schema/features/index.ts.
import { sql } from "drizzle-orm";
import { pgTable, text, varchar, boolean, timestamp, date, decimal, integer, pgEnum, doublePrecision, index, unique, uniqueIndex, json, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod";
import { addendumRecipientTypeEnum, addendumStatusEnum, aiBidDocumentAnalysisStatusEnum, aiCoDraftStatusEnum, aiContractDocumentAnalysisStatusEnum, contractStatusEnum, contractTypeEnum, contractRedlineStatusEnum, contractApprovalDecisionEnum, clauseCategoryEnum, signatureRequestStatusEnum, signerStatusEnum, aiInsightModuleEnum, aiInsightSeverityEnum, aiTakeoffModeEnum, aiTakeoffStatusEnum, aiTakeoffSuggestionStatusEnum, aiTakeoffRejectReasonEnum, aiTaskPriorityEnum, aiTaskStatusEnum, approvalEntityTypeEnum, approvalStatusEnum, atsProviderEnum, bidEquipmentSourceEnum, bidInvitationStatusEnum, bidRequestStatusEnum, bidResponseStatusEnum, blogCommentStatusEnum, blogPostStatusEnum, conversationTypeEnum, crewAvailabilityStatusEnum, crmActivityTypeEnum, crmCallDirectionEnum, crmCallOutcomeEnum, crmCallStatusEnum, crmCustomFieldEntityEnum, crmCustomFieldTypeEnum, crmContactRoleEnum, crmNoteTypeEnum, crmOrgStatusEnum, crmOrganisationTypeEnum, crmPipelineStageEnum, crmPreferredContactEnum, crmLostCategoryEnum, crmQuoteAcceptanceStatusEnum, crmLeadScoringOperatorEnum, crmSequenceStatusEnum, crmSequenceStepTypeEnum, crmSequenceEnrollmentStatusEnum, crmSequenceExecutionStatusEnum, crmSequenceEmailEventTypeEnum, crmSequenceExitReasonEnum, crmQuoteApprovalStatusEnum, dataSubjectRequestStatusEnum, dataSubjectRequestTypeEnum, documentRevisionSourceEnum, documentRevisionStatusEnum, emailClassificationEnum, emailProviderEnum, emailTaskSourceEnum, emailThreadStatusEnum, hiringActivityTypeEnum, hiringCandidateStageEnum, hiringCompensationTypeEnum, hiringEmploymentTypeEnum, hiringInterviewStatusEnum, hiringJobStatusEnum, hiringSyncStatusEnum, hustlerDelegateRoleEnum, hustlerLinkRequestStatusEnum, installationStatusEnum, lidarScanStatusEnum, lidarAnnotationTypeEnum, lidarComparisonTypeEnum, unifiedPaymentMethodEnum, unifiedPaymentStatusEnum, invoiceTypeEnum, integrationConnectionStatusEnum, integrationEventStatusEnum, integrationProviderEnum, issueSeverityEnum, issueStatusEnum, jobsiteAnalysisStatusEnum, lienWaiverStatusEnum, lienWaiverTypeEnum, locationLevelEnum, maintenanceTypeEnum, measurementReviewStatusEnum, measurementSourceEnum, measurementStatusEnum, measurementTypeEnum, takeoffVersionStatusEnum, messageEntityTypeEnum, mobilePlatformEnum, offlineEntityTypeEnum, offlineOperationTypeEnum, offlineSyncStatusEnum, organizationDocumentTypeEnum, organizationDocumentVisibilityEnum, overheadCostActionEnum, overheadCostCategoryEnum, overheadCostFrequencyEnum, portalChatPriorityEnum, portalChatThreadCategoryEnum, portalChatThreadStatusEnum, pricebookImportJobStatusEnum, pricebookStatusEnum, pricingApprovalStatusEnum, pricingSourceTypeEnum, projectEquipmentPlanStatusEnum, repairStatusEnum, retentionActionEnum, retentionEntityTypeEnum, rewardTypeEnum, rfiCategoryEnum, rfiPriorityEnum, rfiStatusEnum, scheduleDependencyTypeEnum, scheduleGeneratedByEnum, scheduleTaskStatusEnum, socialAccountStatusEnum, socialPlatformEnum, socialPostStatusEnum, sovPaymentMethodEnum, sovStatusEnum, storedMaterialStatusEnum, retentionReleaseTypeEnum, retentionReleaseStatusEnum, sowAuditActionEnum, ssoProviderEnum, submittalCategoryEnum, submittalItemStatusEnum, submittalPhaseEnum, submittalReviewRoleEnum, submittalReviewStatusEnum, submittalStatusEnum, submittalTypeEnum, syncStatusEnum, tradeTypeEnum, transmittalStatusEnum, userRoleEnum, vendorEnrollmentStatusEnum, voiceLogStatusEnum, websiteDeploymentActionEnum, websitePageTypeEnum, websiteProjectStatusEnum, websiteStatusEnum, takeoffIssueCategoryEnum, takeoffIssueStatusEnum, talentAvailabilityEnum, talentProfileVisibilityEnum, workflowEntityTypeEnum, riskCategoryEnum, riskStatusEnum, workflowTemplateStatusEnum, workflowInstanceStatusEnum, videoCallStatusEnum, workflowNotificationChannelEnum, dotAgencyKindEnum, dotPayItemTypeEnum, dbeCertificationTypeEnum, suretyBondTypeEnum, suretyBondStatusEnum, haulTicketStatusEnum, swpppInspectionTypeEnum, idrStatusEnum, buyAmericaStatusEnum } from "../enums";
import { bids, organizations, projects, users } from "../core";
import { changeOrders, estimateLineItems, estimates, planDocuments, projectInspections, tasks, tmTickets } from "../operations";
import { takeoffMeasurements, takeoffSheets, standaloneTakeoffs } from "./takeoff";



export const aiSettings = pgTable("ai_settings", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  dailyRunsEnabled: boolean("daily_runs_enabled").notNull().default(true),
  dailyRunTime: text("daily_run_time").notNull().default("06:00"),
  roleTasksEnabled: boolean("role_tasks_enabled").notNull().default(true),
  billingAlertsEnabled: boolean("billing_alerts_enabled").notNull().default(true),
  profitabilityWarningsEnabled: boolean("profitability_warnings_enabled").notNull().default(true),
  crewSchedulingEnabled: boolean("crew_scheduling_enabled").notNull().default(true),
  bidRemindersEnabled: boolean("bid_reminders_enabled").notNull().default(true),
  materialOrderingEnabled: boolean("material_ordering_enabled").notNull().default(true),
  modelName: text("model_name").notNull().default("gpt-5"),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// AI Runs table
export const aiRuns = pgTable("ai_runs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  runType: text("run_type").notNull().default("daily"),
  status: text("status").notNull().default("in_progress"),
  triggeredById: varchar("triggered_by_id").references(() => users.id),
  snapshotData: text("snapshot_data"),
  profitabilityData: text("profitability_data"),
  aiResponse: text("ai_response"),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  completedAt: timestamp("completed_at"),
}, (table) => ({
  createdAtIdx: index("ai_runs_created_at_idx").on(table.createdAt),
}));

// AI Tasks table (role-based prioritized tasks)
export const aiTasks = pgTable("ai_tasks", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  runId: varchar("run_id").notNull().references(() => aiRuns.id, { onDelete: "cascade" }),
  taskType: text("task_type").notNull(),
  role: userRoleEnum("role").notNull(),
  title: text("title").notNull(),
  description: text("description").notNull(),
  priority: aiTaskPriorityEnum("priority").notNull().default("MEDIUM"),
  status: aiTaskStatusEnum("status").notNull().default("PENDING"),
  dueDate: timestamp("due_date"),
  projectId: varchar("project_id").references(() => projects.id, { onDelete: "cascade" }),
  projectCode: text("project_code"),
  metadata: text("metadata"),
  assignedToId: varchar("assigned_to_id").references(() => users.id, { onDelete: "set null" }),
  completedAt: timestamp("completed_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  roleIdx: index("ai_tasks_role_idx").on(table.role),
  statusIdx: index("ai_tasks_status_idx").on(table.status),
  priorityIdx: index("ai_tasks_priority_idx").on(table.priority),
}));

// AI Insight Module Types
export const aiInsights = pgTable("ai_insights", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  projectId: varchar("project_id").references(() => projects.id, { onDelete: "cascade" }),
  module: aiInsightModuleEnum("module").notNull(),
  severity: aiInsightSeverityEnum("severity").notNull().default("INFO"),
  title: text("title").notNull(),
  summary: text("summary").notNull(),
  details: text("details"),
  recommendations: text("recommendations").array(),
  metrics: text("metrics"), // JSON string for module-specific metrics
  affectedEntities: text("affected_entities"), // JSON string for related IDs
  estimatedImpact: text("estimated_impact"), // Cost/time impact description
  actionItems: text("action_items"), // JSON string for specific actions
  isAcknowledged: boolean("is_acknowledged").notNull().default(false),
  acknowledgedById: varchar("acknowledged_by_id").references(() => users.id),
  acknowledgedAt: timestamp("acknowledged_at"),
  triggeredById: varchar("triggered_by_id").references(() => users.id),
  expiresAt: timestamp("expires_at"), // Insights can auto-expire
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  moduleIdx: index("ai_insights_module_idx").on(table.module),
  orgIdx: index("ai_insights_org_idx").on(table.organizationId),
  projectIdx: index("ai_insights_project_idx").on(table.projectId),
  severityIdx: index("ai_insights_severity_idx").on(table.severity),
  createdAtIdx: index("ai_insights_created_at_idx").on(table.createdAt),
}));

// AI Gantt Recommendations (AI-generated scheduling suggestions)
export const aiGanttRecommendations = pgTable("ai_gantt_recommendations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  insightId: varchar("insight_id").references(() => aiInsights.id, { onDelete: "cascade" }),
  recommendationType: text("recommendation_type").notNull(), // TASK_ORDER, RESOURCE_ALLOCATION, CRITICAL_PATH, PARALLEL_WORK
  title: text("title").notNull(),
  description: text("description").notNull(),
  suggestedTasks: text("suggested_tasks"), // JSON array of task suggestions
  suggestedDependencies: text("suggested_dependencies"), // JSON array of dependencies
  estimatedDaysImprovement: integer("estimated_days_improvement"),
  estimatedCostSavings: decimal("estimated_cost_savings", { precision: 12, scale: 2 }),
  isApplied: boolean("is_applied").notNull().default(false),
  appliedById: varchar("applied_by_id").references(() => users.id),
  appliedAt: timestamp("applied_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  projectIdx: index("ai_gantt_recommendations_project_idx").on(table.projectId),
}));

// AI Vendor Comparisons (best pricing analysis)
export const aiVendorComparisons = pgTable("ai_vendor_comparisons", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  insightId: varchar("insight_id").references(() => aiInsights.id, { onDelete: "cascade" }),
  materialCategory: text("material_category").notNull(),
  analysisData: text("analysis_data").notNull(), // JSON with vendor comparisons
  recommendedVendorId: varchar("recommended_vendor_id"),
  recommendedVendorName: text("recommended_vendor_name"),
  potentialSavings: decimal("potential_savings", { precision: 12, scale: 2 }),
  priceConfidence: integer("price_confidence"), // 0-100 confidence score
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  orgIdx: index("ai_vendor_comparisons_org_idx").on(table.organizationId),
  categoryIdx: index("ai_vendor_comparisons_category_idx").on(table.materialCategory),
}));

// AI Bid Document Analysis (AI-powered bid invitation/scope document review)
export const aiBidDocumentAnalysis = pgTable("ai_bid_document_analysis", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  bidId: varchar("bid_id").references(() => bids.id, { onDelete: "cascade" }),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  documentUrl: text("document_url").notNull(),
  documentName: text("document_name").notNull(),
  documentType: text("document_type"), // PDF, IMAGE, etc.
  status: aiBidDocumentAnalysisStatusEnum("status").notNull().default("PENDING"),
  
  // Extracted information
  projectName: text("project_name"),
  clientName: text("client_name"),
  bidDueDate: timestamp("bid_due_date"),
  projectLocation: text("project_location"),
  projectScope: text("project_scope"), // Full scope description
  scopeSummary: text("scope_summary"), // Short summary
  
  // Extracted line items as JSON array
  lineItems: text("line_items"), // JSON: [{description, quantity, unit, notes}]
  
  // Special requirements/qualifications
  requirements: text("requirements"), // JSON array of requirements
  qualifications: text("qualifications"), // JSON array of qualifications needed
  insuranceRequirements: text("insurance_requirements"),
  bondingRequirements: text("bonding_requirements"),
  
  // Pricing guidance
  suggestedPricingFactors: text("suggested_pricing_factors"), // JSON with pricing considerations
  riskFactors: text("risk_factors"), // JSON array of potential risks
  
  // Raw AI response for debugging
  rawAiResponse: text("raw_ai_response"),
  confidenceScore: integer("confidence_score"), // 0-100
  
  analyzedById: varchar("analyzed_by_id").references(() => users.id),
  analyzedAt: timestamp("analyzed_at"),
  errorMessage: text("error_message"),
  
  // Soft delete / Archive fields
  isArchived: boolean("is_archived").notNull().default(false),
  archivedAt: timestamp("archived_at"),
  
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  bidIdx: index("ai_bid_document_analysis_bid_idx").on(table.bidId),
  orgIdx: index("ai_bid_document_analysis_org_idx").on(table.organizationId),
  statusIdx: index("ai_bid_document_analysis_status_idx").on(table.status),
  archivedIdx: index("ai_bid_document_analysis_archived_idx").on(table.isArchived),
}));

// AI Contract/Award Document Analysis (AI-powered award/contract document review)
export const aiContractDocumentAnalysis = pgTable("ai_contract_document_analysis", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: varchar("project_id").references(() => projects.id, { onDelete: "cascade" }),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  documentUrl: text("document_url").notNull(),
  documentName: text("document_name").notNull(),
  documentType: text("document_type"), // PDF, IMAGE, etc.
  status: aiContractDocumentAnalysisStatusEnum("status").notNull().default("PENDING"),
  
  // Contract basics
  contractType: text("contract_type"), // Subcontract, Prime Contract, Change Order, Amendment
  contractNumber: text("contract_number"),
  contractDate: timestamp("contract_date"),
  effectiveDate: timestamp("effective_date"),
  completionDate: timestamp("completion_date"),
  
  // Parties
  ownerName: text("owner_name"),
  generalContractorName: text("general_contractor_name"),
  subcontractorName: text("subcontractor_name"),
  ownerAddress: text("owner_address"),
  gcAddress: text("gc_address"),
  projectName: text("project_name"),
  projectLocation: text("project_location"),
  
  // Contract value and payment
  contractValue: decimal("contract_value", { precision: 14, scale: 2 }),
  retainage: decimal("retainage", { precision: 5, scale: 2 }), // Percentage
  paymentTerms: text("payment_terms"),
  billingSchedule: text("billing_schedule"), // Monthly, milestone-based, etc.
  
  // Scope and work
  scopeOfWork: text("scope_of_work"), // Full scope description
  scopeSummary: text("scope_summary"), // Short summary
  scopeItems: text("scope_items"), // JSON: [{section, description, inclusions, exclusions}]
  exclusions: text("exclusions"), // JSON array of explicit exclusions
  
  // Schedule
  startDate: timestamp("start_date"),
  duration: text("duration"), // "90 days", "3 months", etc.
  milestones: text("milestones"), // JSON: [{name, date, description}]
  liquidatedDamages: text("liquidated_damages"),
  
  // Insurance and bonding
  insuranceRequirements: text("insurance_requirements"), // JSON with limits
  bondingRequirements: text("bonding_requirements"),
  
  // Terms and conditions
  warrantyTerms: text("warranty_terms"),
  changeOrderProcess: text("change_order_process"),
  disputeResolution: text("dispute_resolution"),
  terminationClauses: text("termination_clauses"),
  indemnificationClauses: text("indemnification_clauses"),
  
  // Key clauses extracted
  keyTerms: text("key_terms"), // JSON: [{term, summary, section}]
  riskFactors: text("risk_factors"), // JSON: [{risk, severity, mitigation, section}]
  obligations: text("obligations"), // JSON: [{type, description, deadline}]
  
  // Raw AI response for debugging
  rawAiResponse: text("raw_ai_response"),
  confidenceScore: integer("confidence_score"), // 0-100
  
  analyzedById: varchar("analyzed_by_id").references(() => users.id),
  analyzedAt: timestamp("analyzed_at"),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  projectIdx: index("ai_contract_document_analysis_project_idx").on(table.projectId),
  orgIdx: index("ai_contract_document_analysis_org_idx").on(table.organizationId),
  statusIdx: index("ai_contract_document_analysis_status_idx").on(table.status),
}));

export const insertAISettingsSchema = createInsertSchema(aiSettings).omit({
  id: true,
  updatedAt: true,
});

export const insertAIRunSchema = createInsertSchema(aiRuns).omit({
  id: true,
  createdAt: true,
  completedAt: true,
});

export const insertAITaskSchema = createInsertSchema(aiTasks).omit({
  id: true,
  createdAt: true,
  completedAt: true,
});

export type InsertAISettings = z.infer<typeof insertAISettingsSchema>;
export type AISettings = typeof aiSettings.$inferSelect;

export type InsertAIRun = z.infer<typeof insertAIRunSchema>;
export type AIRun = typeof aiRuns.$inferSelect;

export type InsertAITask = z.infer<typeof insertAITaskSchema>;
export type AITask = typeof aiTasks.$inferSelect;

// AI Insights schemas and types
export const insertAIInsightSchema = createInsertSchema(aiInsights).omit({
  id: true,
  createdAt: true,
  acknowledgedAt: true,
});
export type InsertAIInsight = z.infer<typeof insertAIInsightSchema>;
export type AIInsight = typeof aiInsights.$inferSelect;

export const insertAIGanttRecommendationSchema = createInsertSchema(aiGanttRecommendations).omit({
  id: true,
  createdAt: true,
  appliedAt: true,
});
export type InsertAIGanttRecommendation = z.infer<typeof insertAIGanttRecommendationSchema>;
export type AIGanttRecommendation = typeof aiGanttRecommendations.$inferSelect;

export const insertAIVendorComparisonSchema = createInsertSchema(aiVendorComparisons).omit({
  id: true,
  createdAt: true,
});
export type InsertAIVendorComparison = z.infer<typeof insertAIVendorComparisonSchema>;
export type AIVendorComparison = typeof aiVendorComparisons.$inferSelect;

export const insertAIBidDocumentAnalysisSchema = createInsertSchema(aiBidDocumentAnalysis).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertAIBidDocumentAnalysis = z.infer<typeof insertAIBidDocumentAnalysisSchema>;
export type AIBidDocumentAnalysis = typeof aiBidDocumentAnalysis.$inferSelect;

export const insertAIContractDocumentAnalysisSchema = createInsertSchema(aiContractDocumentAnalysis).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertAIContractDocumentAnalysis = z.infer<typeof insertAIContractDocumentAnalysisSchema>;
export type AIContractDocumentAnalysis = typeof aiContractDocumentAnalysis.$inferSelect;

// AI Data Quality table
export const aiDataQuality = pgTable("ai_data_quality", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  overallScore: integer("overall_score").notNull(),
  financialDataScore: integer("financial_data_score").notNull(),
  laborDataScore: integer("labor_data_score").notNull(),
  materialDataScore: integer("material_data_score").notNull(),
  timelineDataScore: integer("timeline_data_score").notNull(),
  scopeDataScore: integer("scope_data_score").notNull(),
  missingFields: text("missing_fields").array(),
  recommendations: text("recommendations").array(),
  calculatedAt: timestamp("calculated_at").notNull().defaultNow(),
});

export const insertAIDataQualitySchema = createInsertSchema(aiDataQuality).omit({ id: true, calculatedAt: true });
export type InsertAIDataQuality = z.infer<typeof insertAIDataQualitySchema>;
export type AIDataQuality = typeof aiDataQuality.$inferSelect;

// ============================================
// FEATURE A: AI AUTO-TAKEOFF ANALYSES
// AI-powered blueprint/photo analysis for quantity takeoffs
// ============================================
export const aiTakeoffAnalyses = pgTable("ai_takeoff_analyses", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  projectId: varchar("project_id").references(() => projects.id, { onDelete: "cascade" }),
  bidId: varchar("bid_id"),
  // Task #2550 follow-up / Task #2551 — Standalone takeoffs are a third
  // valid parent for an AI takeoff analysis (alongside projects and
  // bids). Nullable; the analyze route enforces that exactly one of
  // project/bid/standalone is set.
  standaloneTakeoffId: varchar("standalone_takeoff_id").references(() => standaloneTakeoffs.id, { onDelete: "cascade" }),
  takeoffSheetId: varchar("takeoff_sheet_id").references(() => takeoffSheets.id, { onDelete: "set null" }),
  tradeType: tradeTypeEnum("trade_type").notNull(),
  status: aiTakeoffStatusEnum("status").notNull().default("PENDING"),
  analysisMode: aiTakeoffModeEnum("analysis_mode").notNull().default("QUICK"),
  fileKey: text("file_key"),
  fileName: text("file_name"),
  detectedItemsJson: text("detected_items_json"),     // AI-detected measurements
  metadataJson: text("metadata_json"),                // Scale, title block, etc.
  aiNotes: text("ai_notes"),
  errorMessage: text("error_message"),
  processingTimeMs: integer("processing_time_ms"),
  // Task #2335 — Persist scale-mismatch evaluation alongside the analysis so
  // the AI takeoff dashboard can roll up calibration drift across sheets and
  // organizations. Null on rows where calibration or detection couldn't be
  // compared (e.g. uncalibrated sheet, model didn't emit a drawingScale);
  // `scaleMismatchDetected = true` means the detected vs. calibrated px/ft
  // disagree by more than the 5% tolerance applied at write time.
  scaleMismatchDetected: boolean("scale_mismatch_detected").notNull().default(false),
  detectedScaleLabel: text("detected_scale_label"),
  calibratedScaleLabel: text("calibrated_scale_label"),
  scaleDeltaPercent: doublePrecision("scale_delta_percent"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  createdByUserId: varchar("created_by_user_id").references(() => users.id),
}, (table) => ({
  projectIdx: index("ai_takeoff_project_idx").on(table.projectId),
  orgIdx: index("ai_takeoff_org_idx").on(table.organizationId),
  // Task #2335 — Partial-style index used by the dashboard rollup query
  // ("how many of my org's analyses had a mismatch this week?"). Drizzle
  // doesn't expose partial-index syntax cleanly, so the index is on
  // (orgId, scaleMismatchDetected, createdAt) and the query filters on
  // `scale_mismatch_detected = true`.
  scaleMismatchIdx: index("ai_takeoff_scale_mismatch_idx").on(
    table.organizationId,
    table.scaleMismatchDetected,
    table.createdAt,
  ),
}));

export const insertAiTakeoffAnalysisSchema = createInsertSchema(aiTakeoffAnalyses).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertAiTakeoffAnalysis = z.infer<typeof insertAiTakeoffAnalysisSchema>;
export type AiTakeoffAnalysis = typeof aiTakeoffAnalyses.$inferSelect;

// ============================================
// Task #2323 — AI takeoff closed-loop feedback
// One row per detected item; replaces the inline JSON for *tracking*
// (the JSON blob on aiTakeoffAnalyses stays for backward-compat reads).
// ============================================
export const aiTakeoffSuggestions = pgTable("ai_takeoff_suggestions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  analysisId: varchar("analysis_id").notNull().references(() => aiTakeoffAnalyses.id, { onDelete: "cascade" }),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  tradeType: tradeTypeEnum("trade_type").notNull(),
  // Original AI-detected payload, mirrored from detected_items_json for the
  // accuracy dashboard and calibration job (no JSON parse needed at query time).
  itemKey: text("item_key").notNull(),                  // matches DetectedItem.id (e.g. "item-3")
  itemType: text("item_type").notNull(),
  description: text("description").notNull(),
  quantity: doublePrecision("quantity").notNull(),
  unit: text("unit").notNull(),
  confidence: doublePrecision("confidence").notNull(),  // model-reported, 0-100
  boundingBoxJson: text("bounding_box_json"),
  // Review state ----------------------------------------------------------
  status: aiTakeoffSuggestionStatusEnum("status").notNull().default("PENDING"),
  reviewedByUserId: varchar("reviewed_by_user_id").references(() => users.id, { onDelete: "set null" }),
  reviewedAt: timestamp("reviewed_at"),
  acceptedMeasurementId: varchar("accepted_measurement_id").references(() => takeoffMeasurements.id, { onDelete: "set null" }),
  // EDITED diff (populated when user changed quantity/unit/itemType at import)
  editedQuantity: doublePrecision("edited_quantity"),
  editedUnit: text("edited_unit"),
  editedItemType: text("edited_item_type"),
  // REJECTED reason
  rejectReason: aiTakeoffRejectReasonEnum("reject_reason"),
  rejectNote: text("reject_note"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  analysisIdx: index("ai_takeoff_sug_analysis_idx").on(table.analysisId),
  orgTradeStatusIdx: index("ai_takeoff_sug_org_trade_status_idx").on(table.organizationId, table.tradeType, table.status),
  // Task #2343 — DB-level idempotency for the closed-loop insert path
  // (runtime `persistDetectedItemsAsSuggestions` and the backfill script).
  // Both call sites can safely ON CONFLICT (analysis_id, item_key) DO NOTHING.
  analysisItemKeyUq: uniqueIndex("ai_takeoff_sug_analysis_item_key_uq").on(table.analysisId, table.itemKey),
}));

export const insertAiTakeoffSuggestionSchema = createInsertSchema(aiTakeoffSuggestions).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertAiTakeoffSuggestion = z.infer<typeof insertAiTakeoffSuggestionSchema>;
export type AiTakeoffSuggestion = typeof aiTakeoffSuggestions.$inferSelect;

// Confidence calibration table — populated nightly by the cron job and
// read at processAiTakeoff time to override displayed confidence with
// per-org empirical acceptance rates when sample_count >= 30.
export const aiTakeoffConfidenceCalibration = pgTable("ai_takeoff_confidence_calibration", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  tradeType: tradeTypeEnum("trade_type").notNull(),
  // Buckets are 60, 70, 80, 90 — the lower bound of [60-69], [70-79], etc.
  modelConfidenceBucket: integer("model_confidence_bucket").notNull(),
  empiricalAcceptanceRate: doublePrecision("empirical_acceptance_rate").notNull(),  // 0..1
  sampleCount: integer("sample_count").notNull(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  orgTradeBucketUq: uniqueIndex("ai_takeoff_calib_org_trade_bucket_uq").on(table.organizationId, table.tradeType, table.modelConfidenceBucket),
}));

export const insertAiTakeoffConfidenceCalibrationSchema = createInsertSchema(aiTakeoffConfidenceCalibration).omit({ id: true, updatedAt: true });
export type InsertAiTakeoffConfidenceCalibration = z.infer<typeof insertAiTakeoffConfidenceCalibrationSchema>;
export type AiTakeoffConfidenceCalibration = typeof aiTakeoffConfidenceCalibration.$inferSelect;

// ============================================
// FEATURE C: AI JOBSITE CAMERA ANALYSIS
// Vision AI for safety, progress, and compliance analysis
// ============================================
export const jobsiteAnalysisBatches = pgTable("jobsite_analysis_batches", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  analysisDate: date("analysis_date").notNull(),
  tradeType: tradeTypeEnum("trade_type"),
  status: jobsiteAnalysisStatusEnum("status").notNull().default("PENDING"),
  analysisTypes: text("analysis_types").array().default(sql`'{SAFETY,PROGRESS}'`),
  summaryJson: text("summary_json"),                  // Overall scores and summary
  safetyFindingsJson: text("safety_findings_json"),   // Safety issues detected
  progressFindingsJson: text("progress_findings_json"), // Progress observations
  materialFindingsJson: text("material_findings_json"), // Material tracking
  crewFindingsJson: text("crew_findings_json"),       // Crew count/PPE
  aiNotes: text("ai_notes"),
  errorMessage: text("error_message"),
  processingTimeMs: integer("processing_time_ms"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  createdByUserId: varchar("created_by_user_id").references(() => users.id),
}, (table) => ({
  projectIdx: index("jobsite_analysis_project_idx").on(table.projectId),
  dateIdx: index("jobsite_analysis_date_idx").on(table.analysisDate),
}));

export const insertJobsiteAnalysisBatchSchema = createInsertSchema(jobsiteAnalysisBatches).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertJobsiteAnalysisBatch = z.infer<typeof insertJobsiteAnalysisBatchSchema>;
export type JobsiteAnalysisBatch = typeof jobsiteAnalysisBatches.$inferSelect;

export const jobsiteAnalysisPhotos = pgTable("jobsite_analysis_photos", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  batchId: varchar("batch_id").notNull().references(() => jobsiteAnalysisBatches.id, { onDelete: "cascade" }),
  fileKey: text("file_key").notNull(),
  fileUrl: text("file_url").notNull(),
  thumbnailUrl: text("thumbnail_url"),
  originalFilename: text("original_filename"),
  capturedAt: timestamp("captured_at"),
  gpsLatitude: decimal("gps_latitude", { precision: 10, scale: 8 }),
  gpsLongitude: decimal("gps_longitude", { precision: 11, scale: 8 }),
  aiAnnotationsJson: text("ai_annotations_json"),     // Per-photo AI findings
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  batchIdx: index("jobsite_photos_batch_idx").on(table.batchId),
}));

export const insertJobsiteAnalysisPhotoSchema = createInsertSchema(jobsiteAnalysisPhotos).omit({ id: true, createdAt: true });
export type InsertJobsiteAnalysisPhoto = z.infer<typeof insertJobsiteAnalysisPhotoSchema>;
export type JobsiteAnalysisPhoto = typeof jobsiteAnalysisPhotos.$inferSelect;

// ============================================
// FEATURE F: AI CHANGE ORDER DRAFTS
// AI-generated change order content before finalization
// ============================================
export const aiCoDrafts = pgTable("ai_co_drafts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  tradeType: tradeTypeEnum("trade_type"),
  linkedItemsJson: text("linked_items_json"),         // Delay IDs, inspection IDs, etc.
  draftContentJson: text("draft_content_json").notNull(), // Title, description, scope, etc.
  pricingJson: text("pricing_json"),                  // Line items with pricing
  aiConfidence: integer("ai_confidence"),
  aiNotes: text("ai_notes"),
  status: aiCoDraftStatusEnum("status").notNull().default("DRAFT"),
  convertedToCoId: varchar("converted_to_co_id").references(() => changeOrders.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  createdByUserId: varchar("created_by_user_id").references(() => users.id),
}, (table) => ({
  projectIdx: index("ai_co_drafts_project_idx").on(table.projectId),
  orgIdx: index("ai_co_drafts_org_idx").on(table.organizationId),
}));

export const insertAiCoDraftSchema = createInsertSchema(aiCoDrafts).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertAiCoDraft = z.infer<typeof insertAiCoDraftSchema>;
export type AiCoDraft = typeof aiCoDrafts.$inferSelect;

// ==========================================
// FIELD PRODUCTIVITY SYSTEM
// ==========================================

// Field Productivity Enums
export const voiceLogs = pgTable("voice_logs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  projectId: varchar("project_id").references(() => projects.id, { onDelete: "set null" }),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  
  // Audio details
  audioUrl: text("audio_url").notNull(),
  audioObjectKey: text("audio_object_key"),
  duration: integer("duration"),  // in seconds
  
  // Transcription
  transcription: text("transcription"),
  status: voiceLogStatusEnum("status").notNull().default("PENDING"),
  transcribedAt: timestamp("transcribed_at"),
  errorMessage: text("error_message"),
  
  // AI-extracted metadata
  aiSummary: text("ai_summary"),
  aiTags: text("ai_tags").array(),
  aiSentiment: text("ai_sentiment"),  // POSITIVE, NEUTRAL, NEGATIVE, URGENT
  
  // Location
  latitude: doublePrecision("latitude"),
  longitude: doublePrecision("longitude"),
  
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  orgIdx: index("voice_logs_org_idx").on(table.organizationId),
  projectIdx: index("voice_logs_project_idx").on(table.projectId),
  userIdx: index("voice_logs_user_idx").on(table.userId),
  statusIdx: index("voice_logs_status_idx").on(table.status),
}));

export const insertVoiceLogSchema = createInsertSchema(voiceLogs).omit({ id: true, createdAt: true, updatedAt: true, transcribedAt: true });
export type InsertVoiceLog = z.infer<typeof insertVoiceLogSchema>;
export type VoiceLog = typeof voiceLogs.$inferSelect;

// Issue Captures table - Field issue/problem documentation
export const issueCaptures = pgTable("issue_captures", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  projectId: varchar("project_id").references(() => projects.id, { onDelete: "set null" }),
  createdById: varchar("created_by_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  assignedToId: varchar("assigned_to_id").references(() => users.id, { onDelete: "set null" }),
  
  // Issue details
  title: text("title").notNull(),
  description: text("description"),
  severity: issueSeverityEnum("severity").notNull().default("MEDIUM"),
  status: issueStatusEnum("status").notNull().default("OPEN"),
  
  // Photos/evidence
  photoUrls: text("photo_urls").array(),
  photoObjectKeys: text("photo_object_keys").array(),
  
  // Location
  location: text("location"),  // Text description of location
  latitude: doublePrecision("latitude"),
  longitude: doublePrecision("longitude"),
  
  // Trade/category
  tradeAffected: text("trade_affected"),
  category: text("category"),  // SAFETY, QUALITY, DELAY, DESIGN, OTHER
  
  // Resolution
  resolutionNotes: text("resolution_notes"),
  resolvedById: varchar("resolved_by_id").references(() => users.id),
  resolvedAt: timestamp("resolved_at"),
  
  // AI analysis
  aiAnalysis: text("ai_analysis"),
  aiRecommendations: text("ai_recommendations"),
  
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  orgIdx: index("issue_captures_org_idx").on(table.organizationId),
  projectIdx: index("issue_captures_project_idx").on(table.projectId),
  createdByIdx: index("issue_captures_created_by_idx").on(table.createdById),
  severityIdx: index("issue_captures_severity_idx").on(table.severity),
  statusIdx: index("issue_captures_status_idx").on(table.status),
}));

export const insertIssueCaptureSchema = createInsertSchema(issueCaptures).omit({ id: true, createdAt: true, updatedAt: true, resolvedAt: true });
export type InsertIssueCapture = z.infer<typeof insertIssueCaptureSchema>;
export type IssueCapture = typeof issueCaptures.$inferSelect;