// AUTO-GENERATED SPLIT FROM shared/schema/features.ts (Task #2426).
// Domain bucketing rule lives in shared/schema/features/index.ts.
import { sql } from "drizzle-orm";
import { pgTable, text, varchar, boolean, timestamp, date, decimal, integer, pgEnum, doublePrecision, index, unique, uniqueIndex, json, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod";
import { addendumRecipientTypeEnum, addendumStatusEnum, aiBidDocumentAnalysisStatusEnum, aiCoDraftStatusEnum, aiContractDocumentAnalysisStatusEnum, contractStatusEnum, contractTypeEnum, contractRedlineStatusEnum, contractApprovalDecisionEnum, clauseCategoryEnum, signatureRequestStatusEnum, signerStatusEnum, aiInsightModuleEnum, aiInsightSeverityEnum, aiTakeoffModeEnum, aiTakeoffStatusEnum, aiTakeoffSuggestionStatusEnum, aiTakeoffRejectReasonEnum, aiTaskPriorityEnum, aiTaskStatusEnum, approvalEntityTypeEnum, approvalStatusEnum, atsProviderEnum, bidEquipmentSourceEnum, bidInvitationStatusEnum, bidRequestStatusEnum, bidResponseStatusEnum, blogCommentStatusEnum, blogPostStatusEnum, conversationTypeEnum, crewAvailabilityStatusEnum, crmActivityTypeEnum, crmCallDirectionEnum, crmCallOutcomeEnum, crmCallStatusEnum, crmCustomFieldEntityEnum, crmCustomFieldTypeEnum, crmContactRoleEnum, crmNoteTypeEnum, crmOrgStatusEnum, crmOrganisationTypeEnum, crmPipelineStageEnum, crmPreferredContactEnum, crmLostCategoryEnum, crmQuoteAcceptanceStatusEnum, crmLeadScoringOperatorEnum, crmSequenceStatusEnum, crmSequenceStepTypeEnum, crmSequenceEnrollmentStatusEnum, crmSequenceExecutionStatusEnum, crmSequenceEmailEventTypeEnum, crmSequenceExitReasonEnum, crmQuoteApprovalStatusEnum, dataSubjectRequestStatusEnum, dataSubjectRequestTypeEnum, documentRevisionSourceEnum, documentRevisionStatusEnum, emailClassificationEnum, emailProviderEnum, emailTaskSourceEnum, emailThreadStatusEnum, hiringActivityTypeEnum, hiringCandidateStageEnum, hiringCompensationTypeEnum, hiringEmploymentTypeEnum, hiringInterviewStatusEnum, hiringJobStatusEnum, hiringSyncStatusEnum, hustlerDelegateRoleEnum, hustlerLinkRequestStatusEnum, installationStatusEnum, lidarScanStatusEnum, lidarAnnotationTypeEnum, lidarComparisonTypeEnum, unifiedPaymentMethodEnum, unifiedPaymentStatusEnum, invoiceTypeEnum, integrationConnectionStatusEnum, integrationEventStatusEnum, integrationProviderEnum, issueSeverityEnum, issueStatusEnum, jobsiteAnalysisStatusEnum, lienWaiverStatusEnum, lienWaiverTypeEnum, locationLevelEnum, maintenanceTypeEnum, measurementReviewStatusEnum, measurementSourceEnum, measurementStatusEnum, measurementTypeEnum, takeoffVersionStatusEnum, messageEntityTypeEnum, mobilePlatformEnum, offlineEntityTypeEnum, offlineOperationTypeEnum, offlineSyncStatusEnum, organizationDocumentTypeEnum, organizationDocumentVisibilityEnum, overheadCostActionEnum, overheadCostCategoryEnum, overheadCostFrequencyEnum, portalChatPriorityEnum, portalChatThreadCategoryEnum, portalChatThreadStatusEnum, pricebookImportJobStatusEnum, pricebookStatusEnum, pricingApprovalStatusEnum, pricingSourceTypeEnum, projectEquipmentPlanStatusEnum, repairStatusEnum, retentionActionEnum, retentionEntityTypeEnum, rewardTypeEnum, rfiCategoryEnum, rfiPriorityEnum, rfiStatusEnum, scheduleDependencyTypeEnum, scheduleGeneratedByEnum, scheduleTaskStatusEnum, socialAccountStatusEnum, socialPlatformEnum, socialPostStatusEnum, sovPaymentMethodEnum, sovStatusEnum, storedMaterialStatusEnum, retentionReleaseTypeEnum, retentionReleaseStatusEnum, sowAuditActionEnum, ssoProviderEnum, submittalCategoryEnum, submittalItemStatusEnum, submittalPhaseEnum, submittalReviewRoleEnum, submittalReviewStatusEnum, submittalStatusEnum, submittalTypeEnum, syncStatusEnum, tradeTypeEnum, transmittalStatusEnum, userRoleEnum, vendorEnrollmentStatusEnum, voiceLogStatusEnum, websiteDeploymentActionEnum, websitePageTypeEnum, websiteProjectStatusEnum, websiteStatusEnum, takeoffIssueCategoryEnum, takeoffIssueStatusEnum, talentAvailabilityEnum, talentProfileVisibilityEnum, workflowEntityTypeEnum, riskCategoryEnum, riskStatusEnum, workflowTemplateStatusEnum, workflowInstanceStatusEnum, videoCallStatusEnum, workflowNotificationChannelEnum, dotAgencyKindEnum, dotPayItemTypeEnum, dbeCertificationTypeEnum, suretyBondTypeEnum, suretyBondStatusEnum, haulTicketStatusEnum, swpppInspectionTypeEnum, idrStatusEnum, buyAmericaStatusEnum } from "../enums";
import { bids, organizations, projects, users } from "../core";
import { changeOrders, estimateLineItems, estimates, planDocuments, projectInspections, tasks, tmTickets } from "../operations";
import { organizationSowItems } from "./org_catalog";



// ============================================
// SCHEDULE OF VALUES (SOV) SYSTEM
// Progress billing and value tracking
// ============================================
export const scheduleOfValues = pgTable("schedule_of_values", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  
  // SOV Header Info
  sovNumber: text("sov_number").notNull(), // e.g., "SOV-001"
  title: text("title").notNull(),
  description: text("description"),
  contractValue: decimal("contract_value", { precision: 14, scale: 2 }).notNull(),
  retainagePercent: decimal("retainage_percent", { precision: 5, scale: 2 }).default("10"),
  
  // Billing Period
  periodNumber: integer("period_number").notNull().default(1),
  periodStart: date("period_start"),
  periodEnd: date("period_end"),
  
  // Status & Tracking
  status: sovStatusEnum("status").notNull().default("DRAFT"),
  approvedById: varchar("approved_by_id").references(() => users.id),
  approvedAt: timestamp("approved_at"),
  submittedAt: timestamp("submitted_at"),
  paidAt: timestamp("paid_at"),
  
  // Totals (calculated)
  totalScheduledValue: decimal("total_scheduled_value", { precision: 14, scale: 2 }),
  totalPreviouslyCompleted: decimal("total_previously_completed", { precision: 14, scale: 2 }),
  totalThisPeriod: decimal("total_this_period", { precision: 14, scale: 2 }),
  totalCompletedToDate: decimal("total_completed_to_date", { precision: 14, scale: 2 }),
  totalMaterialsStored: decimal("total_materials_stored", { precision: 14, scale: 2 }),
  totalRetainage: decimal("total_retainage", { precision: 14, scale: 2 }),
  totalEarnedLessRetainage: decimal("total_earned_less_retainage", { precision: 14, scale: 2 }),
  
  // Generated PDF URL
  pdfUrl: text("pdf_url"),
  pdfGeneratedAt: timestamp("pdf_generated_at"),
  
  createdById: varchar("created_by_id").references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  projectIdx: index("sov_project_idx").on(table.projectId),
  orgIdx: index("sov_org_idx").on(table.organizationId),
  statusIdx: index("sov_status_idx").on(table.status),
}));

export const insertScheduleOfValuesSchema = createInsertSchema(scheduleOfValues).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertScheduleOfValues = z.infer<typeof insertScheduleOfValuesSchema>;
export type ScheduleOfValues = typeof scheduleOfValues.$inferSelect;

export const sovLineItems = pgTable("sov_line_items", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  sovId: varchar("sov_id").notNull().references(() => scheduleOfValues.id, { onDelete: "cascade" }),
  
  // Line Item Details
  lineNumber: integer("line_number").notNull(),
  itemCode: text("item_code"), // e.g., "01.A", "02.B"
  description: text("description").notNull(),
  category: text("category"), // Labor, Material, Equipment, Subcontract
  
  // Values
  scheduledValue: decimal("scheduled_value", { precision: 12, scale: 2 }).notNull(),
  previouslyCompleted: decimal("previously_completed", { precision: 12, scale: 2 }).default("0"),
  thisPeriodCompleted: decimal("this_period_completed", { precision: 12, scale: 2 }).default("0"),
  materialsStored: decimal("materials_stored", { precision: 12, scale: 2 }).default("0"),
  
  // Calculated Fields
  totalCompletedAndStored: decimal("total_completed_and_stored", { precision: 12, scale: 2 }),
  percentComplete: decimal("percent_complete", { precision: 5, scale: 2 }),
  balanceToFinish: decimal("balance_to_finish", { precision: 12, scale: 2 }),
  retainageAmount: decimal("retainage_amount", { precision: 12, scale: 2 }),
  
  // Reference to estimate line item (if applicable)
  estimateLineItemId: varchar("estimate_line_item_id").references(() => estimateLineItems.id, { onDelete: "set null" }),
  
  // Reference to change order (when line item was added from an approved CO)
  linkedChangeOrderId: varchar("linked_change_order_id").references(() => changeOrders.id, { onDelete: "set null" }),
  
  // Unified SOW Tracking - links to organization's master SOW library for billing analytics across projects
  organizationSowItemId: varchar("organization_sow_item_id").references(() => organizationSowItems.id, { onDelete: "set null" }),

  // DOT pay item linking — carries through to DOT progress estimate format
  dotPayItemId: varchar("dot_pay_item_id"),
  dotSpecBookId: varchar("dot_spec_book_id"),
  payItemNumber: varchar("pay_item_number", { length: 64 }),
  specSection: varchar("spec_section", { length: 32 }),

  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  sovIdx: index("sov_line_items_sov_idx").on(table.sovId),
  organizationSowItemIdx: index("sov_line_items_org_sow_item_idx").on(table.organizationSowItemId),
  dotPayItemIdx: index("sov_line_items_dot_pay_item_idx").on(table.dotPayItemId),
}));

export const insertSovLineItemSchema = createInsertSchema(sovLineItems).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertSovLineItem = z.infer<typeof insertSovLineItemSchema>;
export type SovLineItem = typeof sovLineItems.$inferSelect;

// ============================================
// LIEN WAIVERS
// Track conditional/unconditional lien waivers tied to SOV pay apps
// ============================================
export const lienWaivers = pgTable("lien_waivers", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  sovId: varchar("sov_id").references(() => scheduleOfValues.id, { onDelete: "set null" }),
  waiverType: lienWaiverTypeEnum("waiver_type").notNull(),
  status: lienWaiverStatusEnum("status").notNull().default("PENDING"),
  recipientName: text("recipient_name").notNull(),
  recipientCompany: text("recipient_company"),
  throughDate: date("through_date").notNull(),
  amount: decimal("amount", { precision: 14, scale: 2 }).notNull(),
  notes: text("notes"),
  documentUrl: text("document_url"),
  sentAt: timestamp("sent_at"),
  receivedAt: timestamp("received_at"),
  approvedById: varchar("approved_by_id").references(() => users.id),
  approvedAt: timestamp("approved_at"),
  createdById: varchar("created_by_id").references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  projectIdx: index("lien_waivers_project_idx").on(table.projectId),
  orgIdx: index("lien_waivers_org_idx").on(table.organizationId),
  sovIdx: index("lien_waivers_sov_idx").on(table.sovId),
}));

export const insertLienWaiverSchema = createInsertSchema(lienWaivers).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertLienWaiver = z.infer<typeof insertLienWaiverSchema>;
export type LienWaiver = typeof lienWaivers.$inferSelect;

// ============================================
// SOV PAYMENTS
// Track partial and full payments against SOV pay apps
// ============================================
export const sovPayments = pgTable("sov_payments", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  sovId: varchar("sov_id").notNull().references(() => scheduleOfValues.id, { onDelete: "cascade" }),
  paymentNumber: integer("payment_number").notNull().default(1),
  amount: decimal("amount", { precision: 14, scale: 2 }).notNull(),
  paymentDate: date("payment_date").notNull(),
  paymentMethod: sovPaymentMethodEnum("payment_method").default("CHECK"),
  referenceNumber: text("reference_number"),
  notes: text("notes"),
  recordedById: varchar("recorded_by_id").references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  sovIdx: index("sov_payments_sov_idx").on(table.sovId),
  orgIdx: index("sov_payments_org_idx").on(table.organizationId),
}));

export const insertSovPaymentSchema = createInsertSchema(sovPayments).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertSovPayment = z.infer<typeof insertSovPaymentSchema>;
export type SovPayment = typeof sovPayments.$inferSelect;

// ============================================
// AIA PAY APPLICATIONS (G702 Header)
// Track AIA G702 Application & Certificate for Payment data
// ============================================
export const payApplications = pgTable("pay_applications", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  sovId: varchar("sov_id").notNull().references(() => scheduleOfValues.id, { onDelete: "cascade" }),

  applicationNumber: integer("application_number").notNull(),
  periodTo: date("period_to"),

  architectName: text("architect_name"),
  architectAddress: text("architect_address"),
  ownerName: text("owner_name"),
  ownerAddress: text("owner_address"),
  contractorName: text("contractor_name"),
  contractorAddress: text("contractor_address"),
  contractDate: date("contract_date"),
  contractFor: text("contract_for"),

  originalContractSum: decimal("original_contract_sum", { precision: 14, scale: 2 }),
  netChangeByChangeOrders: decimal("net_change_by_change_orders", { precision: 14, scale: 2 }),
  contractSumToDate: decimal("contract_sum_to_date", { precision: 14, scale: 2 }),
  totalCompletedAndStored: decimal("total_completed_and_stored", { precision: 14, scale: 2 }),
  retainagePercent: decimal("retainage_percent", { precision: 5, scale: 2 }),
  totalRetained: decimal("total_retained", { precision: 14, scale: 2 }),
  totalEarnedLessRetainage: decimal("total_earned_less_retainage", { precision: 14, scale: 2 }),
  lessPreviousCertificates: decimal("less_previous_certificates", { precision: 14, scale: 2 }),
  currentPaymentDue: decimal("current_payment_due", { precision: 14, scale: 2 }),
  balanceToFinish: decimal("balance_to_finish", { precision: 14, scale: 2 }),

  status: sovStatusEnum("status").notNull().default("DRAFT"),
  submittedAt: timestamp("submitted_at"),
  approvedAt: timestamp("approved_at"),
  approvedById: varchar("approved_by_id").references(() => users.id),
  rejectionReason: text("rejection_reason"),

  paidAmount: decimal("paid_amount", { precision: 14, scale: 2 }).default("0"),
  paidAt: timestamp("paid_at"),
  paymentReference: text("payment_reference"),
  paymentMethod: text("payment_method"),

  createdById: varchar("created_by_id").references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  projectIdx: index("pay_app_project_idx").on(table.projectId),
  orgIdx: index("pay_app_org_idx").on(table.organizationId),
  sovIdx: index("pay_app_sov_idx").on(table.sovId),
}));

export const insertPayApplicationSchema = createInsertSchema(payApplications).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertPayApplication = z.infer<typeof insertPayApplicationSchema>;
export type PayApplication = typeof payApplications.$inferSelect;

// ============================================
// STORED MATERIALS
// Track materials stored on-site or off-site for G703 billing
// ============================================
export const storedMaterials = pgTable("stored_materials", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  sovId: varchar("sov_id").notNull().references(() => scheduleOfValues.id, { onDelete: "cascade" }),
  sovLineItemId: varchar("sov_line_item_id").references(() => sovLineItems.id, { onDelete: "set null" }),

  description: text("description").notNull(),
  storageLocation: text("storage_location"),
  storageStatus: storedMaterialStatusEnum("storage_status").notNull().default("ON_SITE"),
  deliveryDate: date("delivery_date"),
  incorporatedDate: date("incorporated_date"),
  amount: decimal("amount", { precision: 14, scale: 2 }).notNull(),
  vendor: text("vendor"),
  invoiceReference: text("invoice_reference"),
  notes: text("notes"),

  createdById: varchar("created_by_id").references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  projectIdx: index("stored_mat_project_idx").on(table.projectId),
  orgIdx: index("stored_mat_org_idx").on(table.organizationId),
  sovIdx: index("stored_mat_sov_idx").on(table.sovId),
  lineItemIdx: index("stored_mat_line_item_idx").on(table.sovLineItemId),
}));

export const insertStoredMaterialSchema = createInsertSchema(storedMaterials).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertStoredMaterial = z.infer<typeof insertStoredMaterialSchema>;
export type StoredMaterial = typeof storedMaterials.$inferSelect;

// ============================================
// RETENTION RELEASES
// Track partial and final retention releases with approval
// ============================================
export const retentionReleases = pgTable("retention_releases", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  sovId: varchar("sov_id").references(() => scheduleOfValues.id, { onDelete: "set null" }),

  releaseType: retentionReleaseTypeEnum("release_type").notNull(),
  status: retentionReleaseStatusEnum("status").notNull().default("REQUESTED"),
  amount: decimal("amount", { precision: 14, scale: 2 }).notNull(),
  reason: text("reason"),
  approvedById: varchar("approved_by_id").references(() => users.id),
  approvedAt: timestamp("approved_at"),
  releasedAt: timestamp("released_at"),

  requestedById: varchar("requested_by_id").references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  projectIdx: index("ret_release_project_idx").on(table.projectId),
  orgIdx: index("ret_release_org_idx").on(table.organizationId),
}));

export const insertRetentionReleaseSchema = createInsertSchema(retentionReleases).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertRetentionRelease = z.infer<typeof insertRetentionReleaseSchema>;
export type RetentionRelease = typeof retentionReleases.$inferSelect;

// ── Overhead Cost Items ──────────────────────────────────────────────────────

export const overheadCostItems = pgTable("overhead_cost_items", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  category: overheadCostCategoryEnum("category").notNull().default("OTHER"),
  amount: decimal("amount", { precision: 12, scale: 2 }).notNull(),
  frequency: overheadCostFrequencyEnum("frequency").notNull().default("MONTHLY"),
  amortizationMonths: integer("amortization_months"),
  effectiveDate: date("effective_date"),
  endDate: date("end_date"),
  isActive: boolean("is_active").notNull().default(true),
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  orgIdx: index("overhead_cost_items_org_idx").on(table.organizationId),
  activeIdx: index("overhead_cost_items_active_idx").on(table.organizationId, table.isActive),
}));

export const insertOverheadCostItemSchema = createInsertSchema(overheadCostItems).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertOverheadCostItem = z.infer<typeof insertOverheadCostItemSchema>;
export type OverheadCostItem = typeof overheadCostItems.$inferSelect;

export const overheadCostHistory = pgTable("overhead_cost_history", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  costItemId: varchar("cost_item_id"),
  action: overheadCostActionEnum("action").notNull(),
  performedById: varchar("performed_by_id").references(() => users.id),
  itemName: text("item_name").notNull(),
  previousData: text("previous_data"),
  newData: text("new_data"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  orgIdx: index("overhead_cost_history_org_idx").on(table.organizationId),
  createdAtIdx: index("overhead_cost_history_created_at_idx").on(table.createdAt),
}));

export const insertOverheadCostHistorySchema = createInsertSchema(overheadCostHistory).omit({
  id: true,
  createdAt: true,
});
export type InsertOverheadCostHistory = z.infer<typeof insertOverheadCostHistorySchema>;
export type OverheadCostHistoryEntry = typeof overheadCostHistory.$inferSelect;

export const revenueRecognition = pgTable("revenue_recognition", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  period: text("period").notNull(),
  snapshotDate: date("snapshot_date").notNull(),
  contractValue: decimal("contract_value", { precision: 14, scale: 2 }).notNull().default("0"),
  changeOrderAdjustments: decimal("change_order_adjustments", { precision: 14, scale: 2 }).notNull().default("0"),
  adjustedContractValue: decimal("adjusted_contract_value", { precision: 14, scale: 2 }).notNull().default("0"),
  costsToDate: decimal("costs_to_date", { precision: 14, scale: 2 }).notNull().default("0"),
  estimatedTotalCost: decimal("estimated_total_cost", { precision: 14, scale: 2 }).notNull().default("0"),
  percentComplete: decimal("percent_complete", { precision: 7, scale: 4 }).notNull().default("0"),
  earnedRevenue: decimal("earned_revenue", { precision: 14, scale: 2 }).notNull().default("0"),
  billingsToDate: decimal("billings_to_date", { precision: 14, scale: 2 }).notNull().default("0"),
  overUnderBilling: decimal("over_under_billing", { precision: 14, scale: 2 }).notNull().default("0"),
  grossProfit: decimal("gross_profit", { precision: 14, scale: 2 }).notNull().default("0"),
  grossProfitPercent: decimal("gross_profit_percent", { precision: 7, scale: 4 }).notNull().default("0"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  projectIdx: index("rev_rec_project_idx").on(table.projectId),
  orgIdx: index("rev_rec_org_idx").on(table.organizationId),
  periodIdx: index("rev_rec_period_idx").on(table.period),
  snapshotIdx: index("rev_rec_snapshot_idx").on(table.snapshotDate),
}));

export const insertRevenueRecognitionSchema = createInsertSchema(revenueRecognition).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertRevenueRecognition = z.infer<typeof insertRevenueRecognitionSchema>;
export type RevenueRecognition = typeof revenueRecognition.$inferSelect;

export const unifiedPayments = pgTable("unified_payments", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  invoiceType: invoiceTypeEnum("invoice_type").notNull(),
  invoiceId: varchar("invoice_id").notNull(),
  projectId: varchar("project_id").references(() => projects.id),
  amount: decimal("amount", { precision: 14, scale: 2 }).notNull(),
  paymentDate: date("payment_date").notNull(),
  paymentMethod: unifiedPaymentMethodEnum("payment_method").default("CHECK"),
  referenceNumber: text("reference_number"),
  notes: text("notes"),
  status: unifiedPaymentStatusEnum("status").notNull().default("ACTIVE"),
  voidedAt: timestamp("voided_at"),
  voidedById: varchar("voided_by_id").references(() => users.id),
  voidReason: text("void_reason"),
  recordedById: varchar("recorded_by_id").references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  orgIdx: index("unified_payments_org_idx").on(table.organizationId),
  invoiceIdx: index("unified_payments_invoice_idx").on(table.invoiceType, table.invoiceId),
  projectIdx: index("unified_payments_project_idx").on(table.projectId),
  statusIdx: index("unified_payments_status_idx").on(table.status),
}));

export const insertUnifiedPaymentSchema = createInsertSchema(unifiedPayments).omit({ id: true, createdAt: true, updatedAt: true, voidedAt: true, voidedById: true, voidReason: true });
export type InsertUnifiedPayment = z.infer<typeof insertUnifiedPaymentSchema>;
export type UnifiedPayment = typeof unifiedPayments.$inferSelect;