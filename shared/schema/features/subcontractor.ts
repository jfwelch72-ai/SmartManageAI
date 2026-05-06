// AUTO-GENERATED SPLIT FROM shared/schema/features.ts (Task #2426).
// Domain bucketing rule lives in shared/schema/features/index.ts.
import { sql } from "drizzle-orm";
import { pgTable, text, varchar, boolean, timestamp, date, decimal, integer, pgEnum, doublePrecision, index, unique, uniqueIndex, json, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod";
import { addendumRecipientTypeEnum, addendumStatusEnum, aiBidDocumentAnalysisStatusEnum, aiCoDraftStatusEnum, aiContractDocumentAnalysisStatusEnum, contractStatusEnum, contractTypeEnum, contractRedlineStatusEnum, contractApprovalDecisionEnum, clauseCategoryEnum, signatureRequestStatusEnum, signerStatusEnum, aiInsightModuleEnum, aiInsightSeverityEnum, aiTakeoffModeEnum, aiTakeoffStatusEnum, aiTakeoffSuggestionStatusEnum, aiTakeoffRejectReasonEnum, aiTaskPriorityEnum, aiTaskStatusEnum, approvalEntityTypeEnum, approvalStatusEnum, atsProviderEnum, bidEquipmentSourceEnum, bidInvitationStatusEnum, bidRequestStatusEnum, bidResponseStatusEnum, blogCommentStatusEnum, blogPostStatusEnum, conversationTypeEnum, crewAvailabilityStatusEnum, crmActivityTypeEnum, crmCallDirectionEnum, crmCallOutcomeEnum, crmCallStatusEnum, crmCustomFieldEntityEnum, crmCustomFieldTypeEnum, crmContactRoleEnum, crmNoteTypeEnum, crmOrgStatusEnum, crmOrganisationTypeEnum, crmPipelineStageEnum, crmPreferredContactEnum, crmLostCategoryEnum, crmQuoteAcceptanceStatusEnum, crmLeadScoringOperatorEnum, crmSequenceStatusEnum, crmSequenceStepTypeEnum, crmSequenceEnrollmentStatusEnum, crmSequenceExecutionStatusEnum, crmSequenceEmailEventTypeEnum, crmSequenceExitReasonEnum, crmQuoteApprovalStatusEnum, dataSubjectRequestStatusEnum, dataSubjectRequestTypeEnum, documentRevisionSourceEnum, documentRevisionStatusEnum, emailClassificationEnum, emailProviderEnum, emailTaskSourceEnum, emailThreadStatusEnum, hiringActivityTypeEnum, hiringCandidateStageEnum, hiringCompensationTypeEnum, hiringEmploymentTypeEnum, hiringInterviewStatusEnum, hiringJobStatusEnum, hiringSyncStatusEnum, hustlerDelegateRoleEnum, hustlerLinkRequestStatusEnum, installationStatusEnum, lidarScanStatusEnum, lidarAnnotationTypeEnum, lidarComparisonTypeEnum, unifiedPaymentMethodEnum, unifiedPaymentStatusEnum, invoiceTypeEnum, integrationConnectionStatusEnum, integrationEventStatusEnum, integrationProviderEnum, issueSeverityEnum, issueStatusEnum, jobsiteAnalysisStatusEnum, lienWaiverStatusEnum, lienWaiverTypeEnum, locationLevelEnum, maintenanceTypeEnum, measurementReviewStatusEnum, measurementSourceEnum, measurementStatusEnum, measurementTypeEnum, takeoffVersionStatusEnum, messageEntityTypeEnum, mobilePlatformEnum, offlineEntityTypeEnum, offlineOperationTypeEnum, offlineSyncStatusEnum, organizationDocumentTypeEnum, organizationDocumentVisibilityEnum, overheadCostActionEnum, overheadCostCategoryEnum, overheadCostFrequencyEnum, portalChatPriorityEnum, portalChatThreadCategoryEnum, portalChatThreadStatusEnum, pricebookImportJobStatusEnum, pricebookStatusEnum, pricingApprovalStatusEnum, pricingSourceTypeEnum, projectEquipmentPlanStatusEnum, repairStatusEnum, retentionActionEnum, retentionEntityTypeEnum, rewardTypeEnum, rfiCategoryEnum, rfiPriorityEnum, rfiStatusEnum, scheduleDependencyTypeEnum, scheduleGeneratedByEnum, scheduleTaskStatusEnum, socialAccountStatusEnum, socialPlatformEnum, socialPostStatusEnum, sovPaymentMethodEnum, sovStatusEnum, storedMaterialStatusEnum, retentionReleaseTypeEnum, retentionReleaseStatusEnum, sowAuditActionEnum, ssoProviderEnum, submittalCategoryEnum, submittalItemStatusEnum, submittalPhaseEnum, submittalReviewRoleEnum, submittalReviewStatusEnum, submittalStatusEnum, submittalTypeEnum, syncStatusEnum, tradeTypeEnum, transmittalStatusEnum, userRoleEnum, vendorEnrollmentStatusEnum, voiceLogStatusEnum, websiteDeploymentActionEnum, websitePageTypeEnum, websiteProjectStatusEnum, websiteStatusEnum, takeoffIssueCategoryEnum, takeoffIssueStatusEnum, talentAvailabilityEnum, talentProfileVisibilityEnum, workflowEntityTypeEnum, riskCategoryEnum, riskStatusEnum, workflowTemplateStatusEnum, workflowInstanceStatusEnum, videoCallStatusEnum, workflowNotificationChannelEnum, dotAgencyKindEnum, dotPayItemTypeEnum, dbeCertificationTypeEnum, suretyBondTypeEnum, suretyBondStatusEnum, haulTicketStatusEnum, swpppInspectionTypeEnum, idrStatusEnum, buyAmericaStatusEnum } from "../enums";
import { bids, organizations, projects, users } from "../core";
import { changeOrders, estimateLineItems, estimates, planDocuments, projectInspections, tasks, tmTickets } from "../operations";
import { crmOrganisations } from "./crm";
import { safetyIncidents } from "./safety";



// Subcontractors table
export const subcontractors = pgTable("subcontractors", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyName: text("company_name").notNull(),
  contactName: text("contact_name"),
  email: text("email"),
  phone: text("phone"),
  address: text("address"),
  specialties: text("specialties").array(),
  insuranceExpiration: timestamp("insurance_expiration"),
  notes: text("notes"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertSubcontractorSchema = createInsertSchema(subcontractors).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertSubcontractor = z.infer<typeof insertSubcontractorSchema>;
export type Subcontractor = typeof subcontractors.$inferSelect;

// Subcontractor Contracts table
export const subcontractorContracts = pgTable("subcontractor_contracts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  subcontractorId: varchar("subcontractor_id").notNull().references(() => crmOrganisations.id, { onDelete: "cascade" }),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  contractNumber: text("contract_number").notNull(),
  scopeOfWork: text("scope_of_work").notNull(),
  contractAmount: decimal("contract_amount", { precision: 12, scale: 2 }).notNull(),
  startDate: timestamp("start_date"),
  completionDate: timestamp("completion_date"),
  status: text("status").notNull().default("PENDING"),
  paymentTerms: text("payment_terms"),
  retentionPercent: decimal("retention_percent", { precision: 5, scale: 2 }),
  notes: text("notes"),
  costCode: text("cost_code"),
  billingFrequency: text("billing_frequency").default("MONTHLY"),
  paymentDueDays: integer("payment_due_days").default(30),
  earlyPayDiscount: decimal("early_pay_discount", { precision: 5, scale: 2 }),
  lienWaiverRequired: boolean("lien_waiver_required").default(false),
  createdById: varchar("created_by_id").notNull().references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertSubcontractorContractSchema = createInsertSchema(subcontractorContracts).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertSubcontractorContract = z.infer<typeof insertSubcontractorContractSchema>;
export type SubcontractorContract = typeof subcontractorContracts.$inferSelect;

// Subcontractor Payments table - tracks payable requests from contract completion through payment
export const subcontractorPayments = pgTable("subcontractor_payments", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  contractId: varchar("contract_id").notNull().references(() => subcontractorContracts.id, { onDelete: "cascade" }),
  paymentNumber: integer("payment_number").notNull(),
  amount: decimal("amount", { precision: 12, scale: 2 }).notNull(),
  retentionHeld: decimal("retention_held", { precision: 12, scale: 2 }),
  paymentDate: timestamp("payment_date"),
  description: text("description"),
  invoiceNumber: text("invoice_number"),
  // Status workflow: PENDING -> APPROVED -> PAID (or REJECTED)
  status: text("status").notNull().default("PENDING"),
  // Approval tracking
  approvedById: varchar("approved_by_id").references(() => users.id),
  approvedAt: timestamp("approved_at"),
  // Rejection tracking
  rejectedById: varchar("rejected_by_id").references(() => users.id),
  rejectedAt: timestamp("rejected_at"),
  rejectionReason: text("rejection_reason"),
  // Payment tracking
  paidById: varchar("paid_by_id").references(() => users.id),
  paidAt: timestamp("paid_at"),
  checkNumber: text("check_number"),
  paymentMethod: text("payment_method"), // CHECK, ACH, WIRE, CREDIT_CARD, CASH
  // Auto-creation flag (from contract completion)
  autoCreated: boolean("auto_created").notNull().default(false),
  createdById: varchar("created_by_id").references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  orgIdx: index("subcontractor_payments_org_idx").on(table.organizationId),
  contractIdx: index("subcontractor_payments_contract_idx").on(table.contractId),
  statusIdx: index("subcontractor_payments_status_idx").on(table.status),
}));

export const insertSubcontractorPaymentSchema = createInsertSchema(subcontractorPayments).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertSubcontractorPayment = z.infer<typeof insertSubcontractorPaymentSchema>;
export type SubcontractorPayment = typeof subcontractorPayments.$inferSelect;

// Subcontractor Billing Schedule table
export const subcontractorBillingSchedule = pgTable("subcontractor_billing_schedule", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  contractId: varchar("contract_id").notNull().references(() => subcontractorContracts.id, { onDelete: "cascade" }),
  milestoneNumber: integer("milestone_number").notNull(),
  description: text("description").notNull(),
  scheduledAmount: decimal("scheduled_amount", { precision: 12, scale: 2 }).notNull(),
  scheduledDate: timestamp("scheduled_date"),
  completionPercent: integer("completion_percent"),
  status: text("status").notNull().default("PENDING"),
  completedAt: timestamp("completed_at"),
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertSubcontractorBillingScheduleSchema = createInsertSchema(subcontractorBillingSchedule).omit({ id: true, createdAt: true });
export type InsertSubcontractorBillingSchedule = z.infer<typeof insertSubcontractorBillingScheduleSchema>;
export type SubcontractorBillingSchedule = typeof subcontractorBillingSchedule.$inferSelect;

export const subcontractSovLineItems = pgTable("subcontract_sov_line_items", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  contractId: varchar("contract_id").notNull().references(() => subcontractorContracts.id, { onDelete: "cascade" }),
  itemNumber: integer("item_number").notNull(),
  description: text("description").notNull(),
  scheduledValue: decimal("scheduled_value", { precision: 12, scale: 2 }).notNull(),
  originalValue: decimal("original_value", { precision: 12, scale: 2 }),
  changeOrderRef: text("change_order_ref"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  contractIdx: index("sub_sov_contract_idx").on(table.contractId),
}));

export const insertSubcontractSovLineItemSchema = createInsertSchema(subcontractSovLineItems).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertSubcontractSovLineItem = z.infer<typeof insertSubcontractSovLineItemSchema>;
export type SubcontractSovLineItem = typeof subcontractSovLineItems.$inferSelect;

export const subPayApplications = pgTable("sub_pay_applications", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  contractId: varchar("contract_id").notNull().references(() => subcontractorContracts.id, { onDelete: "cascade" }),
  applicationNumber: integer("application_number").notNull(),
  periodTo: text("period_to"),
  status: text("status").notNull().default("DRAFT"),
  totalScheduledValue: decimal("total_scheduled_value", { precision: 12, scale: 2 }),
  totalCompletedPrevious: decimal("total_completed_previous", { precision: 12, scale: 2 }),
  totalCompletedThisPeriod: decimal("total_completed_this_period", { precision: 12, scale: 2 }),
  totalMaterialsStored: decimal("total_materials_stored", { precision: 12, scale: 2 }),
  totalCompletedToDate: decimal("total_completed_to_date", { precision: 12, scale: 2 }),
  totalRetentionHeld: decimal("total_retention_held", { precision: 12, scale: 2 }),
  netAmountDue: decimal("net_amount_due", { precision: 12, scale: 2 }),
  submittedAt: timestamp("submitted_at"),
  reviewedAt: timestamp("reviewed_at"),
  approvedAt: timestamp("approved_at"),
  approvedById: varchar("approved_by_id").references(() => users.id),
  paidAt: timestamp("paid_at"),
  rejectionReason: text("rejection_reason"),
  createdById: varchar("created_by_id").references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  contractIdx: index("sub_pay_app_contract_idx").on(table.contractId),
  statusIdx: index("sub_pay_app_status_idx").on(table.status),
}));

export const insertSubPayApplicationSchema = createInsertSchema(subPayApplications).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertSubPayApplication = z.infer<typeof insertSubPayApplicationSchema>;
export type SubPayApplication = typeof subPayApplications.$inferSelect;

export const subPayAppLineItems = pgTable("sub_pay_app_line_items", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  payAppId: varchar("pay_app_id").notNull().references(() => subPayApplications.id, { onDelete: "cascade" }),
  sovLineItemId: varchar("sov_line_item_id").notNull().references(() => subcontractSovLineItems.id, { onDelete: "cascade" }),
  previouslyCompleted: decimal("previously_completed", { precision: 12, scale: 2 }).default("0"),
  completedThisPeriod: decimal("completed_this_period", { precision: 12, scale: 2 }).default("0"),
  materialsStored: decimal("materials_stored", { precision: 12, scale: 2 }).default("0"),
  totalCompleted: decimal("total_completed", { precision: 12, scale: 2 }).default("0"),
  percentComplete: decimal("percent_complete", { precision: 5, scale: 2 }).default("0"),
  retentionHeld: decimal("retention_held", { precision: 12, scale: 2 }).default("0"),
}, (table) => ({
  payAppIdx: index("sub_pay_app_line_pay_app_idx").on(table.payAppId),
}));

export const insertSubPayAppLineItemSchema = createInsertSchema(subPayAppLineItems).omit({ id: true });
export type InsertSubPayAppLineItem = z.infer<typeof insertSubPayAppLineItemSchema>;
export type SubPayAppLineItem = typeof subPayAppLineItems.$inferSelect;

export const subRetentionReleases = pgTable("sub_retention_releases", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  contractId: varchar("contract_id").notNull().references(() => subcontractorContracts.id, { onDelete: "cascade" }),
  amount: decimal("amount", { precision: 12, scale: 2 }).notNull(),
  releaseType: text("release_type").notNull().default("PARTIAL"),
  status: text("status").notNull().default("PENDING"),
  reason: text("reason"),
  approvedById: varchar("approved_by_id").references(() => users.id),
  approvedAt: timestamp("approved_at"),
  rejectedById: varchar("rejected_by_id").references(() => users.id),
  rejectedAt: timestamp("rejected_at"),
  rejectionReason: text("rejection_reason"),
  requestedById: varchar("requested_by_id").references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  contractIdx: index("sub_retention_release_contract_idx").on(table.contractId),
}));

export const insertSubRetentionReleaseSchema = createInsertSchema(subRetentionReleases).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertSubRetentionRelease = z.infer<typeof insertSubRetentionReleaseSchema>;
export type SubRetentionRelease = typeof subRetentionReleases.$inferSelect;

export const subPerformanceScores = pgTable("sub_performance_scores", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  contractId: varchar("contract_id").notNull().references(() => subcontractorContracts.id, { onDelete: "cascade" }),
  periodDate: timestamp("period_date").notNull(),
  scheduleAdherence: integer("schedule_adherence"),
  workCompletionPercent: integer("work_completion_percent"),
  qualityScore: integer("quality_score"),
  safetyIncidents: integer("safety_incidents").default(0),
  punchListItems: integer("punch_list_items").default(0),
  overallRating: decimal("overall_rating", { precision: 3, scale: 1 }),
  notes: text("notes"),
  scoredById: varchar("scored_by_id").references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  contractIdx: index("sub_perf_contract_idx").on(table.contractId),
}));

export const insertSubPerformanceScoreSchema = createInsertSchema(subPerformanceScores).omit({ id: true, createdAt: true });
export type InsertSubPerformanceScore = z.infer<typeof insertSubPerformanceScoreSchema>;
export type SubPerformanceScore = typeof subPerformanceScores.$inferSelect;

export const subcontractAttachments = pgTable("subcontract_attachments", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  contractId: varchar("contract_id").notNull().references(() => subcontractorContracts.id, { onDelete: "cascade" }),
  fileName: text("file_name").notNull(),
  fileUrl: text("file_url").notNull(),
  fileSize: integer("file_size"),
  fileType: text("file_type"),
  category: text("category").default("GENERAL"),
  uploadedById: varchar("uploaded_by_id").references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  contractIdx: index("sub_attach_contract_idx").on(table.contractId),
}));

export const insertSubcontractAttachmentSchema = createInsertSchema(subcontractAttachments).omit({ id: true, createdAt: true });
export type InsertSubcontractAttachment = z.infer<typeof insertSubcontractAttachmentSchema>;
export type SubcontractAttachment = typeof subcontractAttachments.$inferSelect;

export const sovRevisionHistory = pgTable("sov_revision_history", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  sovLineItemId: varchar("sov_line_item_id").references(() => subcontractSovLineItems.id, { onDelete: "set null" }),
  contractId: varchar("contract_id").notNull().references(() => subcontractorContracts.id, { onDelete: "cascade" }),
  revisionType: text("revision_type").notNull(),
  previousValue: text("previous_value"),
  newValue: text("new_value"),
  changeOrderRef: text("change_order_ref"),
  changedById: varchar("changed_by_id").references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  contractIdx: index("sov_rev_contract_idx").on(table.contractId),
  sovIdx: index("sov_rev_sov_idx").on(table.sovLineItemId),
}));

export const insertSovRevisionHistorySchema = createInsertSchema(sovRevisionHistory).omit({ id: true, createdAt: true });
export type InsertSovRevisionHistory = z.infer<typeof insertSovRevisionHistorySchema>;
export type SovRevisionHistory = typeof sovRevisionHistory.$inferSelect;

// Subcontractor Bid Requests - GC creates a request for quotes
export const subcontractorBidRequests = pgTable("subcontractor_bid_requests", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  projectId: varchar("project_id").references(() => projects.id, { onDelete: "set null" }),
  bidId: varchar("bid_id").references(() => bids.id, { onDelete: "set null" }),
  
  // Request details
  title: text("title").notNull(),
  description: text("description"),
  scopeOfWork: text("scope_of_work").notNull(),
  
  // Trade requirements
  requiredTrades: text("required_trades").array().notNull(),  // Trade types needed
  
  // Timeline
  bidDueDate: timestamp("bid_due_date").notNull(),
  projectStartDate: date("project_start_date"),
  projectEndDate: date("project_end_date"),
  
  // Location
  projectAddress: text("project_address"),
  projectCity: text("project_city"),
  projectState: text("project_state"),
  projectZip: text("project_zip"),
  
  // Budget hints (optional - GC may not want to disclose)
  budgetRangeMin: decimal("budget_range_min", { precision: 14, scale: 2 }),
  budgetRangeMax: decimal("budget_range_max", { precision: 14, scale: 2 }),
  showBudgetToSubs: boolean("show_budget_to_subs").notNull().default(false),
  
  // Requirements
  requiresBonding: boolean("requires_bonding").notNull().default(false),
  requiresInsurance: boolean("requires_insurance").notNull().default(true),
  insuranceMinimum: decimal("insurance_minimum", { precision: 14, scale: 2 }),
  specialRequirements: text("special_requirements"),
  
  // Attached documents (scope docs, plans, specs)
  attachedFileUrls: text("attached_file_urls").array(),
  attachedFileNames: text("attached_file_names").array(),
  
  // Status
  status: bidRequestStatusEnum("status").notNull().default("DRAFT"),
  publishedAt: timestamp("published_at"),
  closedAt: timestamp("closed_at"),
  awardedAt: timestamp("awarded_at"),
  awardedToOrganizationId: varchar("awarded_to_organization_id").references(() => organizations.id),
  
  // GC notes (private, not visible to subs)
  internalNotes: text("internal_notes"),
  
  // Tracking
  viewCount: integer("view_count").notNull().default(0),
  inviteCount: integer("invite_count").notNull().default(0),
  responseCount: integer("response_count").notNull().default(0),
  
  createdByUserId: varchar("created_by_user_id").references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  orgIdx: index("sub_bid_req_org_idx").on(table.organizationId),
  projectIdx: index("sub_bid_req_project_idx").on(table.projectId),
  statusIdx: index("sub_bid_req_status_idx").on(table.status),
  dueDateIdx: index("sub_bid_req_due_date_idx").on(table.bidDueDate),
}));

export const insertSubcontractorBidRequestSchema = createInsertSchema(subcontractorBidRequests).omit({ id: true, createdAt: true, updatedAt: true, publishedAt: true, closedAt: true, awardedAt: true, viewCount: true, inviteCount: true, responseCount: true });
export type InsertSubcontractorBidRequest = z.infer<typeof insertSubcontractorBidRequestSchema>;
export type SubcontractorBidRequest = typeof subcontractorBidRequests.$inferSelect;

// Subcontractor Bid Invitations - Tracks which subs are invited to bid
export const subcontractorBidInvitations = pgTable("subcontractor_bid_invitations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  bidRequestId: varchar("bid_request_id").notNull().references(() => subcontractorBidRequests.id, { onDelete: "cascade" }),
  
  // Invited organization (platform member)
  invitedOrganizationId: varchar("invited_organization_id").references(() => organizations.id, { onDelete: "cascade" }),
  
  // OR external contact (non-platform member)
  externalCompanyName: text("external_company_name"),
  externalContactName: text("external_contact_name"),
  externalContactEmail: text("external_contact_email"),
  externalContactPhone: text("external_contact_phone"),
  
  // Invitation details
  invitedTradeType: tradeTypeEnum("invited_trade_type"),
  personalMessage: text("personal_message"),
  
  // Status tracking
  status: bidInvitationStatusEnum("status").notNull().default("PENDING"),
  viewedAt: timestamp("viewed_at"),
  respondedAt: timestamp("responded_at"),
  declinedReason: text("declined_reason"),
  
  // Notifications
  emailSentAt: timestamp("email_sent_at"),
  reminderSentAt: timestamp("reminder_sent_at"),
  reminderCount: integer("reminder_count").notNull().default(0),
  
  invitedByUserId: varchar("invited_by_user_id").references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  requestIdx: index("sub_bid_inv_request_idx").on(table.bidRequestId),
  orgIdx: index("sub_bid_inv_org_idx").on(table.invitedOrganizationId),
  statusIdx: index("sub_bid_inv_status_idx").on(table.status),
  uniqueInvite: unique("sub_bid_inv_unique").on(table.bidRequestId, table.invitedOrganizationId),
}));

export const insertSubcontractorBidInvitationSchema = createInsertSchema(subcontractorBidInvitations).omit({ id: true, createdAt: true, updatedAt: true, viewedAt: true, respondedAt: true, emailSentAt: true, reminderSentAt: true, reminderCount: true });
export type InsertSubcontractorBidInvitation = z.infer<typeof insertSubcontractorBidInvitationSchema>;
export type SubcontractorBidInvitation = typeof subcontractorBidInvitations.$inferSelect;

// Subcontractor Bid Responses - Sub's submitted quotes
export const subcontractorBidResponses = pgTable("subcontractor_bid_responses", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  invitationId: varchar("invitation_id").notNull().references(() => subcontractorBidInvitations.id, { onDelete: "cascade" }),
  bidRequestId: varchar("bid_request_id").notNull().references(() => subcontractorBidRequests.id, { onDelete: "cascade" }),
  respondingOrganizationId: varchar("responding_organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  
  // Quote details
  totalBidAmount: decimal("total_bid_amount", { precision: 14, scale: 2 }).notNull(),
  laborCost: decimal("labor_cost", { precision: 14, scale: 2 }),
  materialCost: decimal("material_cost", { precision: 14, scale: 2 }),
  equipmentCost: decimal("equipment_cost", { precision: 14, scale: 2 }),
  otherCost: decimal("other_cost", { precision: 14, scale: 2 }),
  
  // Quote breakdown (optional detailed line items as JSON)
  lineItemsJson: text("line_items_json"),
  
  // Proposal details
  proposalNotes: text("proposal_notes"),
  scopeInclusions: text("scope_inclusions"),
  scopeExclusions: text("scope_exclusions"),
  assumptions: text("assumptions"),
  
  // Timeline
  proposedStartDate: date("proposed_start_date"),
  proposedDuration: integer("proposed_duration"),  // in days
  proposedDurationUnit: text("proposed_duration_unit").default("DAYS"),  // DAYS, WEEKS
  
  // Attached documents
  attachedFileUrls: text("attached_file_urls").array(),
  attachedFileNames: text("attached_file_names").array(),
  
  // Validity
  quoteValidUntil: date("quote_valid_until"),
  
  // Status
  status: bidResponseStatusEnum("status").notNull().default("DRAFT"),
  submittedAt: timestamp("submitted_at"),
  reviewedAt: timestamp("reviewed_at"),
  reviewedByUserId: varchar("reviewed_by_user_id").references(() => users.id),
  
  // GC feedback (private)
  gcInternalRating: integer("gc_internal_rating"),  // 1-5 stars
  gcInternalNotes: text("gc_internal_notes"),
  
  // Sub's internal notes (private to sub)
  subInternalNotes: text("sub_internal_notes"),
  
  createdByUserId: varchar("created_by_user_id").references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  invitationIdx: index("sub_bid_resp_invitation_idx").on(table.invitationId),
  requestIdx: index("sub_bid_resp_request_idx").on(table.bidRequestId),
  orgIdx: index("sub_bid_resp_org_idx").on(table.respondingOrganizationId),
  statusIdx: index("sub_bid_resp_status_idx").on(table.status),
}));

export const insertSubcontractorBidResponseSchema = createInsertSchema(subcontractorBidResponses).omit({ id: true, createdAt: true, updatedAt: true, submittedAt: true, reviewedAt: true });
export type InsertSubcontractorBidResponse = z.infer<typeof insertSubcontractorBidResponseSchema>;
export type SubcontractorBidResponse = typeof subcontractorBidResponses.$inferSelect;

// Bid Request Clarifications - Q&A thread for bid requests
export const bidRequestClarifications = pgTable("bid_request_clarifications", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  bidRequestId: varchar("bid_request_id").notNull().references(() => subcontractorBidRequests.id, { onDelete: "cascade" }),
  
  // Who asked/answered
  askedByOrganizationId: varchar("asked_by_organization_id").references(() => organizations.id),
  askedByUserId: varchar("asked_by_user_id").references(() => users.id),
  
  // Question
  question: text("question").notNull(),
  questionAskedAt: timestamp("question_asked_at").notNull().defaultNow(),
  
  // Answer (by GC)
  answer: text("answer"),
  answeredByUserId: varchar("answered_by_user_id").references(() => users.id),
  answeredAt: timestamp("answered_at"),
  
  // Visibility
  isPublicToAllInvitees: boolean("is_public_to_all_invitees").notNull().default(false),  // If true, all invitees can see Q&A
  
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  requestIdx: index("bid_clarification_request_idx").on(table.bidRequestId),
  askedByIdx: index("bid_clarification_asked_by_idx").on(table.askedByOrganizationId),
}));

export const insertBidRequestClarificationSchema = createInsertSchema(bidRequestClarifications).omit({ id: true, createdAt: true, updatedAt: true, answeredAt: true });
export type InsertBidRequestClarification = z.infer<typeof insertBidRequestClarificationSchema>;
export type BidRequestClarification = typeof bidRequestClarifications.$inferSelect;

// Subcontractor Portal Tokens table
export const subcontractorPortalTokens = pgTable("subcontractor_portal_tokens", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  crmOrganisationId: varchar("crm_organisation_id").notNull().references(() => crmOrganisations.id, { onDelete: "cascade" }),
  contactEmail: text("contact_email").notNull(),
  contactName: text("contact_name").notNull(),
  tokenHash: text("token_hash").notNull().unique(),
  // Task #1614 — deterministic per-token lookup key (HMAC-SHA256 of the
  // raw token using SESSION_SECRET) so `requirePortalAuth` can grab the
  // single candidate row by index instead of scanning every active row
  // and bcrypt-comparing each one. Nullable because legacy rows that
  // pre-date this column cannot be backfilled (we never persist the raw
  // token); the auth path falls back to the legacy linear scan for those
  // rows and opportunistically writes the lookup hash on a successful
  // bcrypt match so subsequent auths are O(1).
  tokenLookupHash: text("token_lookup_hash"),
  permissions: text("permissions").array().notNull().default(sql`ARRAY['view','comment','upload','acknowledge']`),
  status: text("status").notNull().default("active"),
  expiresAt: timestamp("expires_at").notNull(),
  lastAccessedAt: timestamp("last_accessed_at"),
  invitedById: varchar("invited_by_id").references(() => users.id),
  invitedByName: text("invited_by_name"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  revokedAt: timestamp("revoked_at"),
}, (table) => ({
  organizationIdx: index("sub_portal_tokens_org_idx").on(table.organizationId),
  projectIdx: index("sub_portal_tokens_project_idx").on(table.projectId),
  crmOrgIdx: index("sub_portal_tokens_crm_org_idx").on(table.crmOrganisationId),
  tokenIdx: index("sub_portal_tokens_token_idx").on(table.tokenHash),
  // Task #1614 — index the deterministic lookup hash so the "find the
  // single matching active token" query in requirePortalAuth is an
  // index-driven equality lookup rather than a full scan.
  tokenLookupIdx: index("sub_portal_tokens_token_lookup_idx").on(table.tokenLookupHash),
  statusIdx: index("sub_portal_tokens_status_idx").on(table.status),
}));

export const insertSubcontractorPortalTokenSchema = createInsertSchema(subcontractorPortalTokens).omit({ id: true, createdAt: true });
export type InsertSubcontractorPortalToken = z.infer<typeof insertSubcontractorPortalTokenSchema>;
export type SubcontractorPortalToken = typeof subcontractorPortalTokens.$inferSelect;