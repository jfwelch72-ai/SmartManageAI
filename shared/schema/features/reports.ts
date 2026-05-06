// AUTO-GENERATED SPLIT FROM shared/schema/features.ts (Task #2426).
// Domain bucketing rule lives in shared/schema/features/index.ts.
import { sql } from "drizzle-orm";
import { pgTable, text, varchar, boolean, timestamp, date, decimal, integer, pgEnum, doublePrecision, index, unique, uniqueIndex, json, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod";
import { addendumRecipientTypeEnum, addendumStatusEnum, aiBidDocumentAnalysisStatusEnum, aiCoDraftStatusEnum, aiContractDocumentAnalysisStatusEnum, contractStatusEnum, contractTypeEnum, contractRedlineStatusEnum, contractApprovalDecisionEnum, clauseCategoryEnum, signatureRequestStatusEnum, signerStatusEnum, aiInsightModuleEnum, aiInsightSeverityEnum, aiTakeoffModeEnum, aiTakeoffStatusEnum, aiTakeoffSuggestionStatusEnum, aiTakeoffRejectReasonEnum, aiTaskPriorityEnum, aiTaskStatusEnum, approvalEntityTypeEnum, approvalStatusEnum, atsProviderEnum, bidEquipmentSourceEnum, bidInvitationStatusEnum, bidRequestStatusEnum, bidResponseStatusEnum, blogCommentStatusEnum, blogPostStatusEnum, conversationTypeEnum, crewAvailabilityStatusEnum, crmActivityTypeEnum, crmCallDirectionEnum, crmCallOutcomeEnum, crmCallStatusEnum, crmCustomFieldEntityEnum, crmCustomFieldTypeEnum, crmContactRoleEnum, crmNoteTypeEnum, crmOrgStatusEnum, crmOrganisationTypeEnum, crmPipelineStageEnum, crmPreferredContactEnum, crmLostCategoryEnum, crmQuoteAcceptanceStatusEnum, crmLeadScoringOperatorEnum, crmSequenceStatusEnum, crmSequenceStepTypeEnum, crmSequenceEnrollmentStatusEnum, crmSequenceExecutionStatusEnum, crmSequenceEmailEventTypeEnum, crmSequenceExitReasonEnum, crmQuoteApprovalStatusEnum, dataSubjectRequestStatusEnum, dataSubjectRequestTypeEnum, documentRevisionSourceEnum, documentRevisionStatusEnum, emailClassificationEnum, emailProviderEnum, emailTaskSourceEnum, emailThreadStatusEnum, hiringActivityTypeEnum, hiringCandidateStageEnum, hiringCompensationTypeEnum, hiringEmploymentTypeEnum, hiringInterviewStatusEnum, hiringJobStatusEnum, hiringSyncStatusEnum, hustlerDelegateRoleEnum, hustlerLinkRequestStatusEnum, installationStatusEnum, lidarScanStatusEnum, lidarAnnotationTypeEnum, lidarComparisonTypeEnum, unifiedPaymentMethodEnum, unifiedPaymentStatusEnum, invoiceTypeEnum, integrationConnectionStatusEnum, integrationEventStatusEnum, integrationProviderEnum, issueSeverityEnum, issueStatusEnum, jobsiteAnalysisStatusEnum, lienWaiverStatusEnum, lienWaiverTypeEnum, locationLevelEnum, maintenanceTypeEnum, measurementReviewStatusEnum, measurementSourceEnum, measurementStatusEnum, measurementTypeEnum, takeoffVersionStatusEnum, messageEntityTypeEnum, mobilePlatformEnum, offlineEntityTypeEnum, offlineOperationTypeEnum, offlineSyncStatusEnum, organizationDocumentTypeEnum, organizationDocumentVisibilityEnum, overheadCostActionEnum, overheadCostCategoryEnum, overheadCostFrequencyEnum, portalChatPriorityEnum, portalChatThreadCategoryEnum, portalChatThreadStatusEnum, pricebookImportJobStatusEnum, pricebookStatusEnum, pricingApprovalStatusEnum, pricingSourceTypeEnum, projectEquipmentPlanStatusEnum, repairStatusEnum, retentionActionEnum, retentionEntityTypeEnum, rewardTypeEnum, rfiCategoryEnum, rfiPriorityEnum, rfiStatusEnum, scheduleDependencyTypeEnum, scheduleGeneratedByEnum, scheduleTaskStatusEnum, socialAccountStatusEnum, socialPlatformEnum, socialPostStatusEnum, sovPaymentMethodEnum, sovStatusEnum, storedMaterialStatusEnum, retentionReleaseTypeEnum, retentionReleaseStatusEnum, sowAuditActionEnum, ssoProviderEnum, submittalCategoryEnum, submittalItemStatusEnum, submittalPhaseEnum, submittalReviewRoleEnum, submittalReviewStatusEnum, submittalStatusEnum, submittalTypeEnum, syncStatusEnum, tradeTypeEnum, transmittalStatusEnum, userRoleEnum, vendorEnrollmentStatusEnum, voiceLogStatusEnum, websiteDeploymentActionEnum, websitePageTypeEnum, websiteProjectStatusEnum, websiteStatusEnum, takeoffIssueCategoryEnum, takeoffIssueStatusEnum, talentAvailabilityEnum, talentProfileVisibilityEnum, workflowEntityTypeEnum, riskCategoryEnum, riskStatusEnum, workflowTemplateStatusEnum, workflowInstanceStatusEnum, videoCallStatusEnum, workflowNotificationChannelEnum, dotAgencyKindEnum, dotPayItemTypeEnum, dbeCertificationTypeEnum, suretyBondTypeEnum, suretyBondStatusEnum, haulTicketStatusEnum, swpppInspectionTypeEnum, idrStatusEnum, buyAmericaStatusEnum } from "../enums";
import { bids, organizations, projects, users } from "../core";
import { changeOrders, estimateLineItems, estimates, planDocuments, projectInspections, tasks, tmTickets } from "../operations";



// Table 8: project_health_snapshots
export const projectHealthSnapshots = pgTable("project_health_snapshots", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  overallScore: integer("overall_score").notNull(),
  scheduleScore: integer("schedule_score").notNull(),
  budgetScore: integer("budget_score").notNull(),
  rfiSubmittalScore: integer("rfi_submittal_score").notNull(),
  changeOrderScore: integer("change_order_score").notNull(),
  safetyScore: integer("safety_score").notNull(),
  costScore: integer("cost_score"),
  complianceScore: integer("compliance_score"),
  trendDirection: text("trend_direction"),
  aiExplanation: text("ai_explanation"),
  breakdown: json("breakdown"),
  snapshotDate: date("snapshot_date").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  orgIdx: index("project_health_org_idx").on(table.organizationId),
  projectIdx: index("project_health_project_idx").on(table.projectId),
  dateIdx: index("project_health_date_idx").on(table.snapshotDate),
}));

export const insertProjectHealthSnapshotSchema = createInsertSchema(projectHealthSnapshots).omit({ id: true, createdAt: true });
export type InsertProjectHealthSnapshot = z.infer<typeof insertProjectHealthSnapshotSchema>;
export type ProjectHealthSnapshot = typeof projectHealthSnapshots.$inferSelect;

// ─── Project Profitability Snapshots ─────────────────────────────────────────
export const projectProfitabilitySnapshots = pgTable("project_profitability_snapshots", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  projectCode: varchar("project_code").notNull(),
  budget: decimal("budget", { precision: 12, scale: 2 }).notNull().default("0"),
  adjustedBudget: decimal("adjusted_budget", { precision: 12, scale: 2 }).notNull().default("0"),
  totalLaborCost: decimal("total_labor_cost", { precision: 12, scale: 2 }).notNull().default("0"),
  totalMaterialCost: decimal("total_material_cost", { precision: 12, scale: 2 }).notNull().default("0"),
  totalSubcontractorCost: decimal("total_subcontractor_cost", { precision: 12, scale: 2 }).notNull().default("0"),
  totalEquipmentCost: decimal("total_equipment_cost", { precision: 12, scale: 2 }).notNull().default("0"),
  totalTmCost: decimal("total_tm_cost", { precision: 12, scale: 2 }).notNull().default("0"),
  totalOtherExpenses: decimal("total_other_expenses", { precision: 12, scale: 2 }).notNull().default("0"),
  totalActualCost: decimal("total_actual_cost", { precision: 12, scale: 2 }).notNull().default("0"),
  variance: decimal("variance", { precision: 12, scale: 2 }).notNull().default("0"),
  variancePercent: decimal("variance_percent", { precision: 8, scale: 2 }).notNull().default("0"),
  estimatedMargin: decimal("estimated_margin", { precision: 12, scale: 2 }).notNull().default("0"),
  projectedCompletionCost: decimal("projected_completion_cost", { precision: 12, scale: 2 }).notNull().default("0"),
  status: text("status").notNull().default("ON_BUDGET"),
  alertThresholdFired: text("alert_threshold_fired"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  orgIdx: index("prof_snapshot_org_idx").on(table.organizationId),
  projectIdx: index("prof_snapshot_project_idx").on(table.projectId),
  createdIdx: index("prof_snapshot_created_idx").on(table.createdAt),
}));

export const insertProjectProfitabilitySnapshotSchema = createInsertSchema(projectProfitabilitySnapshots).omit({ id: true, createdAt: true });
export type InsertProjectProfitabilitySnapshot = z.infer<typeof insertProjectProfitabilitySnapshotSchema>;
export type ProjectProfitabilitySnapshot = typeof projectProfitabilitySnapshots.$inferSelect;

// ─── Portfolio KPI Weekly Snapshots (Task #902) ──────────────────────────────
// Captures one row per project per ISO week (Sunday UTC). Powers the
// 12-week sparklines on the Portfolio Heatmap and Financial Rollup, and
// lets us show direction-of-travel deltas (e.g. "Health +5 vs 4w ago").
export const projectKpiSnapshots = pgTable("project_kpi_snapshots", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").references(() => organizations.id, { onDelete: "cascade" }),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  weekStart: date("week_start").notNull(),
  health: integer("health").notNull().default(0),
  spi: decimal("spi", { precision: 8, scale: 3 }).notNull().default("1"),
  cpi: decimal("cpi", { precision: 8, scale: 3 }).notNull().default("1"),
  burn: decimal("burn", { precision: 14, scale: 2 }).notNull().default("0"),
  variancePct: decimal("variance_pct", { precision: 8, scale: 2 }).notNull().default("0"),
  schedulePct: integer("schedule_pct").notNull().default(0),
  expectedPct: integer("expected_pct").notNull().default(0),
  openRfis: integer("open_rfis").notNull().default(0),
  openCos: integer("open_cos").notNull().default(0),
  openPunch: integer("open_punch").notNull().default(0),
  capturedAt: timestamp("captured_at").notNull().defaultNow(),
}, (table) => ({
  projectIdx: index("project_kpi_snap_project_idx").on(table.projectId),
  weekIdx: index("project_kpi_snap_week_idx").on(table.weekStart),
  uniqProjectWeek: uniqueIndex("project_kpi_snap_project_week_uniq").on(table.projectId, table.weekStart),
}));

export const insertProjectKpiSnapshotSchema = createInsertSchema(projectKpiSnapshots).omit({ id: true, capturedAt: true });
export type InsertProjectKpiSnapshot = z.infer<typeof insertProjectKpiSnapshotSchema>;
export type ProjectKpiSnapshot = typeof projectKpiSnapshots.$inferSelect;

export const executiveDigests = pgTable("executive_digests", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  period: text("period").notNull(),
  generatedAt: timestamp("generated_at").notNull().defaultNow(),
  executiveSummary: text("executive_summary").notNull(),
  keyHighlights: json("key_highlights").notNull().$type<string[]>(),
  sections: json("sections").notNull().$type<{
    title: string;
    icon: string;
    summary: string;
    bullets: string[];
    sentiment: string;
  }[]>(),
  actionItems: json("action_items").notNull().$type<{
    priority: string;
    description: string;
    dueBy?: string;
  }[]>(),
  kpiSnapshot: json("kpi_snapshot").notNull().$type<{
    name: string;
    current: number;
    previous: number;
    unit: string;
    trend: string;
  }[]>(),
  generatedBy: varchar("generated_by").references(() => users.id, { onDelete: "set null" }),
}, (table) => ({
  orgPeriodIdx: index("executive_digests_org_period_idx").on(table.organizationId, table.period),
  generatedAtIdx: index("executive_digests_generated_at_idx").on(table.generatedAt),
}));