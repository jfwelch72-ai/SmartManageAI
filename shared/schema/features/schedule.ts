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



// ============================================
// FEATURE B: PROJECT SCHEDULES
// AI-powered scheduling with Gantt-style task management
// ============================================
export const projectSchedules = pgTable("project_schedules", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  name: text("name").notNull().default("Master Schedule"),
  generatedBy: scheduleGeneratedByEnum("generated_by").notNull().default("MANUAL"),
  baselineStartDate: date("baseline_start_date"),
  baselineEndDate: date("baseline_end_date"),
  actualStartDate: date("actual_start_date"),
  actualEndDate: date("actual_end_date"),
  workingDays: integer("working_days").array().default(sql`'{1,2,3,4,5}'`),
  optionsJson: text("options_json"),
  aiNotes: text("ai_notes"),
  version: integer("version").notNull().default(1),
  isActive: boolean("is_active").notNull().default(true),
  baselineLocked: boolean("baseline_locked").notNull().default(false),
  baselineLockedAt: timestamp("baseline_locked_at"),
  activeBaselineId: varchar("active_baseline_id"),
  projectedCompletionDate: date("projected_completion_date"),
  spiValue: decimal("spi_value", { precision: 5, scale: 3 }),
  lookAheadHorizonWeeks: integer("look_ahead_horizon_weeks").notNull().default(3),
  lastSlipNotifiedAt: timestamp("last_slip_notified_at"),
  lastSlipVarianceDays: integer("last_slip_variance_days"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  createdByUserId: varchar("created_by_user_id").references(() => users.id),
}, (table) => ({
  projectIdx: index("project_schedules_project_idx").on(table.projectId),
  orgIdx: index("project_schedules_org_idx").on(table.organizationId),
}));

export const insertProjectScheduleSchema = createInsertSchema(projectSchedules).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertProjectSchedule = z.infer<typeof insertProjectScheduleSchema>;
export type ProjectSchedule = typeof projectSchedules.$inferSelect;

export const scheduleBaselines = pgTable("schedule_baselines", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  scheduleId: varchar("schedule_id").notNull().references(() => projectSchedules.id, { onDelete: "cascade" }),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  lockedAt: timestamp("locked_at").notNull().defaultNow(),
  lockedByUserId: varchar("locked_by_user_id").references(() => users.id),
  isArchived: boolean("is_archived").notNull().default(false),
  scheduleStartDate: date("schedule_start_date"),
  scheduleEndDate: date("schedule_end_date"),
  taskSnapshotsJson: text("task_snapshots_json").notNull().default("[]"),
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  scheduleIdx: index("schedule_baselines_schedule_idx").on(table.scheduleId),
  orgIdx: index("schedule_baselines_org_idx").on(table.organizationId),
}));

export const insertScheduleBaselineSchema = createInsertSchema(scheduleBaselines).omit({ id: true, createdAt: true, lockedAt: true });
export type InsertScheduleBaseline = z.infer<typeof insertScheduleBaselineSchema>;
export type ScheduleBaseline = typeof scheduleBaselines.$inferSelect;

export const projectScheduleTasks = pgTable("project_schedule_tasks", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  scheduleId: varchar("schedule_id").notNull().references(() => projectSchedules.id, { onDelete: "cascade" }),
  parentTaskId: varchar("parent_task_id").references((): any => projectScheduleTasks.id, { onDelete: "set null" }),
  name: text("name").notNull(),
  description: text("description"),
  tradeType: tradeTypeEnum("trade_type"),
  plannedStartDate: date("planned_start_date"),
  plannedEndDate: date("planned_end_date"),
  actualStartDate: date("actual_start_date"),
  actualEndDate: date("actual_end_date"),
  durationDays: integer("duration_days"),
  dependencies: varchar("dependencies").array(),
  percentComplete: integer("percent_complete").notNull().default(0),
  isCriticalPath: boolean("is_critical_path").notNull().default(false),
  isMilestone: boolean("is_milestone").notNull().default(false),
  crewId: varchar("crew_id").references(() => crews.id),
  sowItemIds: varchar("sow_item_ids").array(),
  inspectionId: varchar("inspection_id").references(() => projectInspections.id),
  delayIds: varchar("delay_ids").array(),
  status: scheduleTaskStatusEnum("status").notNull().default("NOT_STARTED"),
  sortOrder: integer("sort_order").notNull().default(0),
  earlyStart: date("early_start"),
  earlyFinish: date("early_finish"),
  lateStart: date("late_start"),
  lateFinish: date("late_finish"),
  totalFloat: integer("total_float"),
  freeFloat: integer("free_float"),
  baselineStartDate: date("baseline_start_date"),
  baselineEndDate: date("baseline_end_date"),
  crewIds: varchar("crew_ids").array(),
  wbsCode: varchar("wbs_code", { length: 64 }),
  outlineLevel: integer("outline_level").notNull().default(0),
  costCodeId: varchar("cost_code_id"),
  purchaseOrderId: varchar("purchase_order_id"),
  submittalId: varchar("submittal_id"),
  externalSourceRef: varchar("external_source_ref", { length: 128 }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  scheduleIdx: index("schedule_tasks_schedule_idx").on(table.scheduleId),
  parentIdx: index("schedule_tasks_parent_idx").on(table.parentTaskId),
}));

export const insertProjectScheduleTaskSchema = createInsertSchema(projectScheduleTasks).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertProjectScheduleTask = z.infer<typeof insertProjectScheduleTaskSchema>;
export type ProjectScheduleTask = typeof projectScheduleTasks.$inferSelect;

export const scheduleTaskDependencies = pgTable("schedule_task_dependencies", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  scheduleId: varchar("schedule_id").notNull().references(() => projectSchedules.id, { onDelete: "cascade" }),
  predecessorTaskId: varchar("predecessor_task_id").notNull().references(() => projectScheduleTasks.id, { onDelete: "cascade" }),
  successorTaskId: varchar("successor_task_id").notNull().references(() => projectScheduleTasks.id, { onDelete: "cascade" }),
  dependencyType: scheduleDependencyTypeEnum("dependency_type").notNull().default("FS"),
  lagDays: integer("lag_days").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  scheduleIdx: index("schedule_task_deps_schedule_idx").on(table.scheduleId),
  successorIdx: index("schedule_task_deps_successor_idx").on(table.successorTaskId),
  predecessorIdx: index("schedule_task_deps_predecessor_idx").on(table.predecessorTaskId),
  uniqEdge: uniqueIndex("schedule_task_deps_unique_edge_idx").on(
    table.successorTaskId,
    table.predecessorTaskId,
  ),
}));

export const insertScheduleTaskDependencySchema = createInsertSchema(scheduleTaskDependencies).omit({ id: true, createdAt: true });
export type InsertScheduleTaskDependency = z.infer<typeof insertScheduleTaskDependencySchema>;
export type ScheduleTaskDependency = typeof scheduleTaskDependencies.$inferSelect;

export const scheduleForecastSnapshots = pgTable("schedule_forecast_snapshots", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  scheduleId: varchar("schedule_id").notNull().references(() => projectSchedules.id, { onDelete: "cascade" }),
  snapshotDate: date("snapshot_date").notNull(),
  projectedCompletionDate: date("projected_completion_date"),
  spiValue: decimal("spi_value", { precision: 5, scale: 3 }),
  baselineEndDate: date("baseline_end_date"),
  currentEndDate: date("current_end_date"),
  criticalPathDaysRemaining: integer("critical_path_days_remaining"),
  overallProgress: integer("overall_progress"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  scheduleIdx: index("forecast_snapshots_schedule_idx").on(table.scheduleId),
  dateIdx: index("forecast_snapshots_date_idx").on(table.snapshotDate),
}));

export const insertScheduleForecastSnapshotSchema = createInsertSchema(scheduleForecastSnapshots).omit({ id: true, createdAt: true });
export type InsertScheduleForecastSnapshot = z.infer<typeof insertScheduleForecastSnapshotSchema>;
export type ScheduleForecastSnapshot = typeof scheduleForecastSnapshots.$inferSelect;

// ============================================
// GANTT PDF ALERT RECIPIENTS
// Operator-managed list of email recipients for Gantt PDF queue/disconnect
// outage alerts. When at least one row exists here, it overrides both the
// GANTT_PDF_ALERT_EMAILS env var fallback and the active-super-admin fallback.
// ============================================
export const ganttPdfAlertRecipients = pgTable("gantt_pdf_alert_recipients", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  email: text("email").notNull().unique(),
  notifyInApp: boolean("notify_in_app").notNull().default(true),
  userId: varchar("user_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
export const insertGanttPdfAlertRecipientSchema = createInsertSchema(ganttPdfAlertRecipients).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertGanttPdfAlertRecipient = z.infer<typeof insertGanttPdfAlertRecipientSchema>;
export type GanttPdfAlertRecipient = typeof ganttPdfAlertRecipients.$inferSelect;

// ============================================
// GANTT PDF ALERT DELIVERIES
// Audit trail of every dispatched Gantt PDF alert (test or real). Lets admins
// verify deliverability over time without digging through server logs.
// ============================================
export const ganttPdfAlertDeliveries = pgTable("gantt_pdf_alert_deliveries", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  kind: text("kind").notNull(),
  recipients: text("recipients").array().notNull(),
  recipientCount: integer("recipient_count").notNull(),
  emailSuccess: boolean("email_success").notNull(),
  errorMessage: text("error_message"),
  triggeredBy: text("triggered_by"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => ({
  createdAtIdx: index("gantt_pdf_alert_deliveries_created_at_idx").on(t.createdAt),
}));
export const insertGanttPdfAlertDeliverySchema = createInsertSchema(ganttPdfAlertDeliveries).omit({ id: true, createdAt: true });
export type InsertGanttPdfAlertDelivery = z.infer<typeof insertGanttPdfAlertDeliverySchema>;
export type GanttPdfAlertDelivery = typeof ganttPdfAlertDeliveries.$inferSelect;

// ============================================
// PORTFOLIO PDF ALERT RECIPIENTS (Task #940)
// Mirrors gantt_pdf_alert_recipients — operator-managed recipient list for
// portfolio PDF availability/failure alerts.
// ============================================
export const portfolioPdfAlertRecipients = pgTable("portfolio_pdf_alert_recipients", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  email: text("email").notNull().unique(),
  notifyInApp: boolean("notify_in_app").notNull().default(true),
  userId: varchar("user_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
export const insertPortfolioPdfAlertRecipientSchema = createInsertSchema(portfolioPdfAlertRecipients).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertPortfolioPdfAlertRecipient = z.infer<typeof insertPortfolioPdfAlertRecipientSchema>;
export type PortfolioPdfAlertRecipient = typeof portfolioPdfAlertRecipients.$inferSelect;

export const portfolioPdfAlertDeliveries = pgTable("portfolio_pdf_alert_deliveries", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  kind: text("kind").notNull(),
  recipients: text("recipients").array().notNull(),
  recipientCount: integer("recipient_count").notNull(),
  emailSuccess: boolean("email_success").notNull(),
  errorMessage: text("error_message"),
  triggeredBy: text("triggered_by"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => ({
  createdAtIdx: index("portfolio_pdf_alert_deliveries_created_at_idx").on(t.createdAt),
}));
export const insertPortfolioPdfAlertDeliverySchema = createInsertSchema(portfolioPdfAlertDeliveries).omit({ id: true, createdAt: true });
export type InsertPortfolioPdfAlertDelivery = z.infer<typeof insertPortfolioPdfAlertDeliverySchema>;
export type PortfolioPdfAlertDelivery = typeof portfolioPdfAlertDeliveries.$inferSelect;

// ============================================
// SHARED PDF ALERT RECIPIENTS / DELIVERIES (Task #990)
// Single recipient list shared by both Gantt and Portfolio PDF alert
// pipelines. Per-service opt-in flags (notifyGantt / notifyPortfolio) let an
// admin keep one address but pick which pipeline(s) it receives. Deliveries
// are written to a single audit table with a `service` discriminator.
//
// The legacy gantt_pdf_alert_recipients / portfolio_pdf_alert_recipients and
// gantt_pdf_alert_deliveries / portfolio_pdf_alert_deliveries tables remain
// for one release as a safety net. Startup migration backfills rows here.
// ============================================
export const pdfAlertRecipients = pgTable("pdf_alert_recipients", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  email: text("email").notNull().unique(),
  notifyInApp: boolean("notify_in_app").notNull().default(true),
  notifyGantt: boolean("notify_gantt").notNull().default(true),
  notifyPortfolio: boolean("notify_portfolio").notNull().default(true),
  userId: varchar("user_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
export const insertPdfAlertRecipientSchema = createInsertSchema(pdfAlertRecipients).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertPdfAlertRecipient = z.infer<typeof insertPdfAlertRecipientSchema>;
export type PdfAlertRecipient = typeof pdfAlertRecipients.$inferSelect;

export const pdfAlertDeliveries = pgTable("pdf_alert_deliveries", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  service: text("service").notNull(),
  kind: text("kind").notNull(),
  recipients: text("recipients").array().notNull(),
  recipientCount: integer("recipient_count").notNull(),
  emailSuccess: boolean("email_success").notNull(),
  errorMessage: text("error_message"),
  triggeredBy: text("triggered_by"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => ({
  serviceCreatedAtIdx: index("pdf_alert_deliveries_service_created_at_idx").on(t.service, t.createdAt),
}));
export const insertPdfAlertDeliverySchema = createInsertSchema(pdfAlertDeliveries).omit({ id: true, createdAt: true });
export type InsertPdfAlertDelivery = z.infer<typeof insertPdfAlertDeliverySchema>;
export type PdfAlertDelivery = typeof pdfAlertDeliveries.$inferSelect;