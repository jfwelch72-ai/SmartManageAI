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
import { organizationSowItems } from "./org_catalog";



// Vendor Pricing Catalog - Quarterly pricing from suppliers/vendors for materials
// Used to auto-populate bid estimates with current pricing
// Unified system: manual entry + vendor portal submissions + pricebook imports
export const vendorPricingCatalogs = pgTable("vendor_pricing_catalogs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  crmOrganisationId: varchar("crm_organisation_id").notNull().references(() => crmOrganisations.id, { onDelete: "cascade" }),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }), // Contractor receiving this pricing
  
  // Item Details
  itemName: text("item_name").notNull(), // "Ready Mix Concrete 4000 PSI"
  itemCode: text("item_code"), // Vendor's SKU/item code
  category: text("category").notNull(), // CONCRETE, STONE, REBAR, LUMBER, etc.
  description: text("description"),
  unit: text("unit").notNull(), // YARD, TON, EACH, LF, SF, etc.
  
  // Pricing
  unitPrice: decimal("unit_price", { precision: 12, scale: 4 }).notNull(),
  minimumOrder: decimal("minimum_order", { precision: 10, scale: 2 }),
  deliveryFee: decimal("delivery_fee", { precision: 10, scale: 2 }),
  
  // Effective Period (Quarterly)
  effectiveQuarter: text("effective_quarter").notNull(), // "2025-Q1", "2025-Q2", etc.
  effectiveDate: timestamp("effective_date").notNull(),
  expirationDate: timestamp("expiration_date"),
  
  // Source Documentation
  sourceDocUrl: text("source_doc_url"), // Link to price sheet PDF
  sourceDocName: text("source_doc_name"),
  
  // Lead Time
  leadTimeDays: integer("lead_time_days"),
  
  // Unified Pricing Source Tracking
  sourceType: pricingSourceTypeEnum("source_type").notNull().default("MANUAL"),
  approvalStatus: pricingApprovalStatusEnum("approval_status").default("AUTO_APPROVED"),
  submittedByVendorUserId: varchar("submitted_by_vendor_user_id").references(() => users.id),
  approvedByUserId: varchar("approved_by_user_id").references(() => users.id),
  approvedAt: timestamp("approved_at"),
  pricebookImportId: varchar("pricebook_import_id"), // Reference to original pricebook if imported
  
  isActive: boolean("is_active").notNull().default(true),
  createdById: varchar("created_by_id").references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  crmOrgIdx: index("vendor_pricing_catalogs_crm_org_idx").on(table.crmOrganisationId),
  orgIdx: index("vendor_pricing_catalogs_org_idx").on(table.organizationId),
  categoryIdx: index("vendor_pricing_catalogs_category_idx").on(table.category),
  quarterIdx: index("vendor_pricing_catalogs_quarter_idx").on(table.effectiveQuarter),
  activeIdx: index("vendor_pricing_catalogs_active_idx").on(table.isActive),
  sourceIdx: index("vendor_pricing_catalogs_source_idx").on(table.sourceType),
}));

export const insertVendorPricingCatalogSchema = createInsertSchema(vendorPricingCatalogs).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertVendorPricingCatalog = z.infer<typeof insertVendorPricingCatalogSchema>;
export type VendorPricingCatalog = typeof vendorPricingCatalogs.$inferSelect;

// Vendor Enrollments - Links vendors to contractor organizations they serve
// Enables vendors to send pricing directly to enrolled clients
export const vendorEnrollments = pgTable("vendor_enrollments", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  vendorCrmOrgId: varchar("vendor_crm_org_id").notNull().references(() => crmOrganisations.id, { onDelete: "cascade" }),
  contractorOrgId: varchar("contractor_org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  
  // Enrollment Status
  status: vendorEnrollmentStatusEnum("status").notNull().default("PENDING"),
  
  // Enrollment Settings
  autoApproveNewPricing: boolean("auto_approve_new_pricing").notNull().default(false),
  notifyOnPriceUpdate: boolean("notify_on_price_update").notNull().default(true),
  
  // Invitation/Enrollment tracking
  invitedByUserId: varchar("invited_by_user_id").references(() => users.id),
  invitedAt: timestamp("invited_at").notNull().defaultNow(),
  enrolledAt: timestamp("enrolled_at"),
  enrollmentCode: varchar("enrollment_code").unique(), // Code for vendor self-enrollment
  
  // Categories this vendor is enrolled for
  enrolledCategories: text("enrolled_categories").array(), // ["CONCRETE", "STONE", "REBAR"]
  
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  vendorIdx: index("vendor_enrollments_vendor_idx").on(table.vendorCrmOrgId),
  contractorIdx: index("vendor_enrollments_contractor_idx").on(table.contractorOrgId),
  statusIdx: index("vendor_enrollments_status_idx").on(table.status),
  vendorContractorUnique: unique("vendor_enrollments_unique").on(table.vendorCrmOrgId, table.contractorOrgId),
}));

export const insertVendorEnrollmentSchema = createInsertSchema(vendorEnrollments).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertVendorEnrollment = z.infer<typeof insertVendorEnrollmentSchema>;
export type VendorEnrollment = typeof vendorEnrollments.$inferSelect;

// Vendor Users - Links CRM organizations (vendors) to user accounts for portal access
export const vendorUsers = pgTable("vendor_users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  crmOrganisationId: varchar("crm_organisation_id").notNull().references(() => crmOrganisations.id, { onDelete: "cascade" }),
  
  // Vendor portal permissions
  canSubmitPricing: boolean("can_submit_pricing").notNull().default(true),
  canViewEnrollments: boolean("can_view_enrollments").notNull().default(true),
  canManageUsers: boolean("can_manage_users").notNull().default(false),
  isPrimaryContact: boolean("is_primary_contact").notNull().default(false),
  
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  userIdx: index("vendor_users_user_idx").on(table.userId),
  crmOrgIdx: index("vendor_users_crm_org_idx").on(table.crmOrganisationId),
  userCrmOrgUnique: unique("vendor_users_unique").on(table.userId, table.crmOrganisationId),
}));

export const insertVendorUserSchema = createInsertSchema(vendorUsers).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertVendorUser = z.infer<typeof insertVendorUserSchema>;
export type VendorUser = typeof vendorUsers.$inferSelect;

// ============================================
// FEATURE D: VENDOR PRICING SYNC
// Pricebook import and material pricing management
// ============================================
export const vendorPricebooks = pgTable("vendor_pricebooks", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  vendorId: varchar("vendor_id").notNull().references(() => crmOrganisations.id, { onDelete: "cascade" }),
  fileKey: text("file_key").notNull(),
  fileName: text("file_name"),
  fileType: text("file_type").notNull(),              // CSV, XLSX
  effectiveDate: date("effective_date"),
  expirationDate: date("expiration_date"),
  tradeType: tradeTypeEnum("trade_type"),
  mappingPresetJson: text("mapping_preset_json"),     // Saved column mappings
  status: pricebookStatusEnum("status").notNull().default("PENDING"),
  itemCount: integer("item_count").notNull().default(0),
  importedAt: timestamp("imported_at"),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  uploadedByUserId: varchar("uploaded_by_user_id").references(() => users.id),
}, (table) => ({
  vendorIdx: index("pricebooks_vendor_idx").on(table.vendorId),
  orgIdx: index("pricebooks_org_idx").on(table.organizationId),
}));

export const insertVendorPricebookSchema = createInsertSchema(vendorPricebooks).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertVendorPricebook = z.infer<typeof insertVendorPricebookSchema>;
export type VendorPricebook = typeof vendorPricebooks.$inferSelect;

export const vendorPricebookItems = pgTable("vendor_pricebook_items", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  pricebookId: varchar("pricebook_id").notNull().references(() => vendorPricebooks.id, { onDelete: "cascade" }),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  vendorId: varchar("vendor_id").notNull().references(() => crmOrganisations.id),
  vendorCode: text("vendor_code").notNull(),
  vendorDescription: text("vendor_description").notNull(),
  vendorUnit: text("vendor_unit"),
  category: text("category").notNull(),
  unit: text("unit").notNull(),                       // Standardized UOM
  unitPrice: decimal("unit_price", { precision: 12, scale: 4 }).notNull(),
  markupPercent: decimal("markup_percent", { precision: 5, scale: 2 }).default("0"),
  sowItemId: varchar("sow_item_id").references(() => organizationSowItems.id),
  calculatorKey: text("calculator_key"),
  isActive: boolean("is_active").notNull().default(true),
  effectiveDate: date("effective_date"),
  expirationDate: date("expiration_date"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  pricebookIdx: index("pricebook_items_pricebook_idx").on(table.pricebookId),
  vendorIdx: index("pricebook_items_vendor_idx").on(table.vendorId),
  categoryIdx: index("pricebook_items_category_idx").on(table.category),
}));

export const insertVendorPricebookItemSchema = createInsertSchema(vendorPricebookItems).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertVendorPricebookItem = z.infer<typeof insertVendorPricebookItemSchema>;
export type VendorPricebookItem = typeof vendorPricebookItems.$inferSelect;

export const vendorPriceHistory = pgTable("vendor_price_history", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  pricebookItemId: varchar("pricebook_item_id").notNull().references(() => vendorPricebookItems.id, { onDelete: "cascade" }),
  oldPrice: decimal("old_price", { precision: 12, scale: 4 }),
  newPrice: decimal("new_price", { precision: 12, scale: 4 }).notNull(),
  changePercent: decimal("change_percent", { precision: 6, scale: 2 }),
  effectiveDate: date("effective_date").notNull(),
  recordedAt: timestamp("recorded_at").notNull().defaultNow(),
}, (table) => ({
  itemIdx: index("price_history_item_idx").on(table.pricebookItemId),
}));

export const insertVendorPriceHistorySchema = createInsertSchema(vendorPriceHistory).omit({ id: true, recordedAt: true });
export type InsertVendorPriceHistory = z.infer<typeof insertVendorPriceHistorySchema>;
export type VendorPriceHistory = typeof vendorPriceHistory.$inferSelect;

// Pricebook Import Jobs table - tracks AI extraction jobs for vendor price lists
export const pricebookImportJobs = pgTable("pricebook_import_jobs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  crmOrganisationId: varchar("crm_organisation_id").notNull().references(() => crmOrganisations.id, { onDelete: "cascade" }),
  fileRef: text("file_ref").notNull(),
  fileName: text("file_name").notNull(),
  status: pricebookImportJobStatusEnum("status").notNull().default("PENDING"),
  itemsExtracted: integer("items_extracted").default(0),
  itemsApproved: integer("items_approved").default(0),
  errorMessage: text("error_message"),
  effectiveQuarter: text("effective_quarter"),
  effectiveDate: timestamp("effective_date"),
  processedAt: timestamp("processed_at"),
  createdById: varchar("created_by_id").notNull().references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  orgIdx: index("pricebook_import_jobs_org_idx").on(table.organizationId),
  vendorIdx: index("pricebook_import_jobs_vendor_idx").on(table.crmOrganisationId),
  statusIdx: index("pricebook_import_jobs_status_idx").on(table.status),
}));

export const insertPricebookImportJobSchema = createInsertSchema(pricebookImportJobs).omit({ id: true, createdAt: true, updatedAt: true, processedAt: true });
export type InsertPricebookImportJob = z.infer<typeof insertPricebookImportJobSchema>;
export type PricebookImportJob = typeof pricebookImportJobs.$inferSelect;

// ==========================================
// MARKETPLACE SYSTEM
// ==========================================

// Marketplace Enums
export const vendorScores = pgTable("vendor_scores", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  crmEntityId: varchar("crm_entity_id").notNull().references(() => crmOrganisations.id, { onDelete: "cascade" }),
  projectId: varchar("project_id").references(() => projects.id, { onDelete: "set null" }),
  
  // Scoring date
  scoreDate: date("score_date").notNull(),
  
  // Individual category scores (1-5 scale)
  onTimeDeliveryScore: decimal("on_time_delivery_score", { precision: 3, scale: 2 }),
  qualityScore: decimal("quality_score", { precision: 3, scale: 2 }),
  communicationScore: decimal("communication_score", { precision: 3, scale: 2 }),
  priceCompetitivenessScore: decimal("price_competitiveness_score", { precision: 3, scale: 2 }),
  reliabilityScore: decimal("reliability_score", { precision: 3, scale: 2 }),
  
  // Overall calculated score
  overallScore: decimal("overall_score", { precision: 3, scale: 2 }),
  
  // Additional context
  notes: text("notes"),
  scoredById: varchar("scored_by_id").notNull().references(() => users.id),
  
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  orgIdx: index("vendor_scores_org_idx").on(table.organizationId),
  vendorIdx: index("vendor_scores_vendor_idx").on(table.crmEntityId),
  projectIdx: index("vendor_scores_project_idx").on(table.projectId),
  scoreDateIdx: index("vendor_scores_date_idx").on(table.scoreDate),
}));

export const insertVendorScoreSchema = createInsertSchema(vendorScores).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertVendorScore = z.infer<typeof insertVendorScoreSchema>;
export type VendorScore = typeof vendorScores.$inferSelect;

// Material Price Index table - Track material pricing over time
export const materialPriceIndex = pgTable("material_price_index", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  
  // Material identification
  materialName: text("material_name").notNull(),
  materialCategory: text("material_category"),  // CONCRETE, LUMBER, STEEL, etc.
  materialSku: text("material_sku"),  // Vendor-specific SKU
  
  // Unit and pricing
  unitOfMeasure: text("unit_of_measure").notNull(),  // CY, LF, SF, EA, etc.
  pricePerUnit: decimal("price_per_unit", { precision: 12, scale: 4 }).notNull(),
  
  // Validity period
  effectiveDate: date("effective_date").notNull(),
  expirationDate: date("expiration_date"),
  
  // Source information
  sourceVendorId: varchar("source_vendor_id").references(() => crmOrganisations.id, { onDelete: "set null" }),
  region: text("region"),  // Geographic region for pricing
  
  // Metadata
  notes: text("notes"),
  createdById: varchar("created_by_id").references(() => users.id),
  
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  orgIdx: index("material_price_org_idx").on(table.organizationId),
  materialIdx: index("material_price_material_idx").on(table.materialName),
  categoryIdx: index("material_price_category_idx").on(table.materialCategory),
  effectiveDateIdx: index("material_price_effective_idx").on(table.effectiveDate),
  vendorIdx: index("material_price_vendor_idx").on(table.sourceVendorId),
}));

export const insertMaterialPriceIndexSchema = createInsertSchema(materialPriceIndex).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertMaterialPriceIndex = z.infer<typeof insertMaterialPriceIndexSchema>;
export type MaterialPriceIndex = typeof materialPriceIndex.$inferSelect;