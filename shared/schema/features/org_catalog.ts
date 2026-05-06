// AUTO-GENERATED SPLIT FROM shared/schema/features.ts (Task #2426).
// Domain bucketing rule lives in shared/schema/features/index.ts.
import { sql } from "drizzle-orm";
import { pgTable, text, varchar, boolean, timestamp, date, decimal, integer, pgEnum, doublePrecision, index, unique, uniqueIndex, json, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod";
import { addendumRecipientTypeEnum, addendumStatusEnum, aiBidDocumentAnalysisStatusEnum, aiCoDraftStatusEnum, aiContractDocumentAnalysisStatusEnum, contractStatusEnum, contractTypeEnum, contractRedlineStatusEnum, contractApprovalDecisionEnum, clauseCategoryEnum, signatureRequestStatusEnum, signerStatusEnum, aiInsightModuleEnum, aiInsightSeverityEnum, aiTakeoffModeEnum, aiTakeoffStatusEnum, aiTakeoffSuggestionStatusEnum, aiTakeoffRejectReasonEnum, aiTaskPriorityEnum, aiTaskStatusEnum, approvalEntityTypeEnum, approvalStatusEnum, atsProviderEnum, bidEquipmentSourceEnum, bidInvitationStatusEnum, bidRequestStatusEnum, bidResponseStatusEnum, blogCommentStatusEnum, blogPostStatusEnum, conversationTypeEnum, crewAvailabilityStatusEnum, crmActivityTypeEnum, crmCallDirectionEnum, crmCallOutcomeEnum, crmCallStatusEnum, crmCustomFieldEntityEnum, crmCustomFieldTypeEnum, crmContactRoleEnum, crmNoteTypeEnum, crmOrgStatusEnum, crmOrganisationTypeEnum, crmPipelineStageEnum, crmPreferredContactEnum, crmLostCategoryEnum, crmQuoteAcceptanceStatusEnum, crmLeadScoringOperatorEnum, crmSequenceStatusEnum, crmSequenceStepTypeEnum, crmSequenceEnrollmentStatusEnum, crmSequenceExecutionStatusEnum, crmSequenceEmailEventTypeEnum, crmSequenceExitReasonEnum, crmQuoteApprovalStatusEnum, dataSubjectRequestStatusEnum, dataSubjectRequestTypeEnum, documentRevisionSourceEnum, documentRevisionStatusEnum, emailClassificationEnum, emailProviderEnum, emailTaskSourceEnum, emailThreadStatusEnum, hiringActivityTypeEnum, hiringCandidateStageEnum, hiringCompensationTypeEnum, hiringEmploymentTypeEnum, hiringInterviewStatusEnum, hiringJobStatusEnum, hiringSyncStatusEnum, hustlerDelegateRoleEnum, hustlerLinkRequestStatusEnum, installationStatusEnum, lidarScanStatusEnum, lidarAnnotationTypeEnum, lidarComparisonTypeEnum, unifiedPaymentMethodEnum, unifiedPaymentStatusEnum, invoiceTypeEnum, integrationConnectionStatusEnum, integrationEventStatusEnum, integrationProviderEnum, issueSeverityEnum, issueStatusEnum, jobsiteAnalysisStatusEnum, lienWaiverStatusEnum, lienWaiverTypeEnum, locationLevelEnum, maintenanceTypeEnum, measurementReviewStatusEnum, measurementSourceEnum, measurementStatusEnum, measurementTypeEnum, takeoffVersionStatusEnum, messageEntityTypeEnum, mobilePlatformEnum, offlineEntityTypeEnum, offlineOperationTypeEnum, offlineSyncStatusEnum, organizationDocumentTypeEnum, organizationDocumentVisibilityEnum, overheadCostActionEnum, overheadCostCategoryEnum, overheadCostFrequencyEnum, portalChatPriorityEnum, portalChatThreadCategoryEnum, portalChatThreadStatusEnum, pricebookImportJobStatusEnum, pricebookStatusEnum, pricingApprovalStatusEnum, pricingSourceTypeEnum, projectEquipmentPlanStatusEnum, repairStatusEnum, retentionActionEnum, retentionEntityTypeEnum, rewardTypeEnum, rfiCategoryEnum, rfiPriorityEnum, rfiStatusEnum, scheduleDependencyTypeEnum, scheduleGeneratedByEnum, scheduleTaskStatusEnum, socialAccountStatusEnum, socialPlatformEnum, socialPostStatusEnum, sovPaymentMethodEnum, sovStatusEnum, storedMaterialStatusEnum, retentionReleaseTypeEnum, retentionReleaseStatusEnum, sowAuditActionEnum, ssoProviderEnum, submittalCategoryEnum, submittalItemStatusEnum, submittalPhaseEnum, submittalReviewRoleEnum, submittalReviewStatusEnum, submittalStatusEnum, submittalTypeEnum, syncStatusEnum, tradeTypeEnum, transmittalStatusEnum, userRoleEnum, vendorEnrollmentStatusEnum, voiceLogStatusEnum, websiteDeploymentActionEnum, websitePageTypeEnum, websiteProjectStatusEnum, websiteStatusEnum, takeoffIssueCategoryEnum, takeoffIssueStatusEnum, talentAvailabilityEnum, talentProfileVisibilityEnum, workflowEntityTypeEnum, riskCategoryEnum, riskStatusEnum, workflowTemplateStatusEnum, workflowInstanceStatusEnum, videoCallStatusEnum, workflowNotificationChannelEnum, dotAgencyKindEnum, dotPayItemTypeEnum, dbeCertificationTypeEnum, suretyBondTypeEnum, suretyBondStatusEnum, haulTicketStatusEnum, swpppInspectionTypeEnum, idrStatusEnum, buyAmericaStatusEnum } from "../enums";
import { bids, organizations, projects, users } from "../core";
import { changeOrders, estimateLineItems, estimates, planDocuments, projectInspections, tasks, tmTickets } from "../operations";
import { dotAgencies } from "./dot";



// Trade Templates - Pre-built configurations for different trades
export const tradeTemplates = pgTable("trade_templates", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tradeType: tradeTypeEnum("trade_type").notNull().unique(),
  displayName: text("display_name").notNull(),
  description: text("description"),
  csiDivision: text("csi_division"),              // CSI code (e.g., "03", "31", "07")
  iconName: text("icon_name"),                    // Lucide icon name
  colorHex: text("color_hex"),                    // Brand color for this trade
  materialCategories: text("material_categories").notNull(),
  workTypesJson: text("work_types_json").notNull(),
  calculatorConfigJson: text("calculator_config_json").notNull(),
  terminologyJson: text("terminology_json"),
  defaultUnitsJson: text("default_units_json"),
  enabledFeaturesJson: text("enabled_features_json"), // Features this trade unlocks
  isGcTrade: boolean("is_gc_trade").notNull().default(false), // True = GC gets this trade's features
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertTradeTemplateSchema = createInsertSchema(tradeTemplates).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertTradeTemplate = z.infer<typeof insertTradeTemplateSchema>;
export type TradeTemplate = typeof tradeTemplates.$inferSelect;

// Organization Material Calculators - Custom calculators per organization
export const organizationCalculators = pgTable("organization_calculators", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  category: text("category").notNull(),
  unit: text("unit").notNull(),
  formulaJson: text("formula_json").notNull(),
  inputFieldsJson: text("input_fields_json").notNull(),
  defaultValues: text("default_values"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  orgIdx: index("org_calculators_org_idx").on(table.organizationId),
}));

export const insertOrganizationCalculatorSchema = createInsertSchema(organizationCalculators).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertOrganizationCalculator = z.infer<typeof insertOrganizationCalculatorSchema>;
export type OrganizationCalculator = typeof organizationCalculators.$inferSelect;

// Organization Work Types - Custom work types per organization
export const organizationWorkTypes = pgTable("organization_work_types", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  category: text("category"),
  unit: text("unit").notNull(),
  defaultProductionRate: decimal("default_production_rate", { precision: 10, scale: 2 }),
  laborCostPerUnit: decimal("labor_cost_per_unit", { precision: 10, scale: 2 }),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  orgIdx: index("org_work_types_org_idx").on(table.organizationId),
}));

export const insertOrganizationWorkTypeSchema = createInsertSchema(organizationWorkTypes).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertOrganizationWorkType = z.infer<typeof insertOrganizationWorkTypeSchema>;
export type OrganizationWorkType = typeof organizationWorkTypes.$inferSelect;

// Organization SOW Items - Scope of Work items specific to each organization
export const organizationSowItems = pgTable("organization_sow_items", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  categoryName: text("category_name").notNull(),
  name: text("name").notNull(),
  code: text("code").notNull(),
  description: text("description"),
  unit: text("unit"),
  requiresDimensions: boolean("requires_dimensions").notNull().default(false),
  dimensionLabel: text("dimension_label"),
  defaultCostCode: varchar("default_cost_code", { length: 20 }),
  displayOrder: integer("display_order").notNull().default(0),
  isFromTemplate: boolean("is_from_template").notNull().default(false),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  orgIdx: index("org_sow_items_org_idx").on(table.organizationId),
  categoryIdx: index("org_sow_items_category_idx").on(table.categoryName),
  codeOrgUnique: unique("org_sow_items_code_org_unique").on(table.organizationId, table.code),
}));

export const insertOrganizationSowItemSchema = createInsertSchema(organizationSowItems).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertOrganizationSowItem = z.infer<typeof insertOrganizationSowItemSchema>;
export type OrganizationSowItem = typeof organizationSowItems.$inferSelect;

// SOW Audit Log - Track all SOW item changes for compliance
export const sowAuditLog = pgTable("sow_audit_log", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  action: sowAuditActionEnum("action").notNull(),
  sowCode: text("sow_code"),
  sowName: text("sow_name"),
  details: text("details"),
  previousTradeType: tradeTypeEnum("previous_trade_type"),
  newTradeType: tradeTypeEnum("new_trade_type"),
  itemCount: integer("item_count"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  orgIdx: index("sow_audit_log_org_idx").on(table.organizationId),
  userIdx: index("sow_audit_log_user_idx").on(table.userId),
  actionIdx: index("sow_audit_log_action_idx").on(table.action),
}));

export const insertSowAuditLogSchema = createInsertSchema(sowAuditLog).omit({ id: true, createdAt: true });
export type InsertSowAuditLog = z.infer<typeof insertSowAuditLogSchema>;
export type SowAuditLog = typeof sowAuditLog.$inferSelect;

// ============================================
// ORGANIZATION DOCUMENTS
// Company branding assets and compliance documents
// ============================================
export const organizationDocuments = pgTable("organization_documents", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  type: organizationDocumentTypeEnum("type").notNull(),
  name: text("name").notNull(),
  description: text("description"),
  fileUrl: text("file_url").notNull(),
  objectKey: text("object_key"),
  mimeType: text("mime_type"),
  fileSize: integer("file_size"),
  visibility: organizationDocumentVisibilityEnum("visibility").notNull().default("INTERNAL"),
  version: integer("version").notNull().default(1),
  uploadedById: varchar("uploaded_by_id").references(() => users.id, { onDelete: "set null" }),
  effectiveDate: date("effective_date"),
  expiresAt: date("expires_at"),
  notes: text("notes"),
  replacesDocumentId: varchar("replaces_document_id"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  orgIdx: index("org_docs_org_idx").on(table.organizationId),
  typeIdx: index("org_docs_type_idx").on(table.type),
  activeTypeOrgUnique: unique("org_docs_active_type_org_unique").on(table.organizationId, table.type, table.isActive),
}));

export const insertOrganizationDocumentSchema = createInsertSchema(organizationDocuments).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertOrganizationDocument = z.infer<typeof insertOrganizationDocumentSchema>;
export type OrganizationDocument = typeof organizationDocuments.$inferSelect;

// ============================================
// STANDARDIZED UNITS OF MEASURE (UOM)
// Platform-wide dropdown for consistency & AI tracking
// ============================================
export const unitsOfMeasure = pgTable("units_of_measure", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  code: text("code").notNull().unique(),           // SF, LF, CY, EA, etc.
  name: text("name").notNull(),                    // Square Foot, Linear Foot, etc.
  abbreviation: text("abbreviation").notNull(),   // sq ft, lin ft, cu yd
  category: text("category").notNull(),           // area, length, volume, quantity, time, weight, capacity
  description: text("description"),
  conversionFactor: decimal("conversion_factor", { precision: 12, scale: 6 }), // For unit conversions
  baseUnit: text("base_unit"),                    // Reference to base unit code for conversions
  sortOrder: integer("sort_order").notNull().default(0),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertUnitOfMeasureSchema = createInsertSchema(unitsOfMeasure).omit({ id: true, createdAt: true });
export type InsertUnitOfMeasure = z.infer<typeof insertUnitOfMeasureSchema>;
export type UnitOfMeasure = typeof unitsOfMeasure.$inferSelect;

// ============================================
// MASTER SOW ITEMS (Template Library)
// Pre-built scope of work items by trade for onboarding
// ============================================
export const masterSowItems = pgTable("master_sow_items", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tradeType: tradeTypeEnum("trade_type").notNull(),
  csiCode: text("csi_code"),                      // CSI division code (e.g., "03", "31 20")
  categoryName: text("category_name").notNull(),   // Grouping category
  name: text("name").notNull(),                    // SOW item name
  code: text("code").notNull(),                    // Short code for the item
  description: text("description"),
  defaultUomCode: text("default_uom_code"),        // References unitsOfMeasure.code
  requiresDimensions: boolean("requires_dimensions").notNull().default(false),
  dimensionLabel: text("dimension_label"),         // e.g., "Area (SF)", "Length (LF)"
  laborRateMultiplier: decimal("labor_rate_multiplier", { precision: 6, scale: 2 }), // For estimating
  materialWasteFactor: decimal("material_waste_factor", { precision: 5, scale: 2 }), // e.g., 1.10 for 10% waste
  sortOrder: integer("sort_order").notNull().default(0),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  tradeIdx: index("master_sow_trade_idx").on(table.tradeType),
  csiIdx: index("master_sow_csi_idx").on(table.csiCode),
  codeUnique: unique("master_sow_code_trade_unique").on(table.tradeType, table.code),
}));

export const insertMasterSowItemSchema = createInsertSchema(masterSowItems).omit({ id: true, createdAt: true });
export type InsertMasterSowItem = z.infer<typeof insertMasterSowItemSchema>;
export type MasterSowItem = typeof masterSowItems.$inferSelect;

// ============================================
// MASTER CALCULATORS (Template Library)
// Pre-built material calculators by trade
// ============================================
export const masterCalculators = pgTable("master_calculators", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tradeType: tradeTypeEnum("trade_type").notNull(),
  name: text("name").notNull(),                    // e.g., "Concrete Volume Calculator"
  category: text("category").notNull(),            // e.g., "Foundations", "Slabs"
  description: text("description"),
  outputUomCode: text("output_uom_code").notNull(), // Output unit (CY, SF, etc.)
  formulaJson: text("formula_json").notNull(),     // Calculation formula
  inputFieldsJson: text("input_fields_json").notNull(), // Input field definitions
  defaultValuesJson: text("default_values_json"),  // Default input values
  helpText: text("help_text"),                     // Usage instructions
  sortOrder: integer("sort_order").notNull().default(0),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  tradeIdx: index("master_calc_trade_idx").on(table.tradeType),
}));

export const insertMasterCalculatorSchema = createInsertSchema(masterCalculators).omit({ id: true, createdAt: true });
export type InsertMasterCalculator = z.infer<typeof insertMasterCalculatorSchema>;
export type MasterCalculator = typeof masterCalculators.$inferSelect;

// ============================================
// MASTER INSPECTION FORMS (Template Library)
// Trade-specific inspection/documentation requirements
// ============================================
export const masterInspectionForms = pgTable("master_inspection_forms", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tradeType: tradeTypeEnum("trade_type").notNull(),
  name: text("name").notNull(),                    // e.g., "Pre-Pour Inspection Checklist"
  category: text("category").notNull(),            // e.g., "Quality Control", "Safety"
  description: text("description"),
  formFieldsJson: text("form_fields_json").notNull(), // Form field definitions
  requiresPhotos: boolean("requires_photos").notNull().default(false),
  requiresSignature: boolean("requires_signature").notNull().default(false),
  regulatoryReference: text("regulatory_reference"), // e.g., "NFPA 13", "ADA"
  sortOrder: integer("sort_order").notNull().default(0),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  tradeIdx: index("master_forms_trade_idx").on(table.tradeType),
}));

export const insertMasterInspectionFormSchema = createInsertSchema(masterInspectionForms).omit({ id: true, createdAt: true });
export type InsertMasterInspectionForm = z.infer<typeof insertMasterInspectionFormSchema>;
export type MasterInspectionForm = typeof masterInspectionForms.$inferSelect;

// ============================================
// TRADE FEATURES - Define what features each trade enables
// For dynamic UI generation
// ============================================
export const tradeFeatures = pgTable("trade_features", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tradeType: tradeTypeEnum("trade_type").notNull(),
  featureKey: text("feature_key").notNull(),       // e.g., "equipment_tracking", "weather_scheduling"
  featureName: text("feature_name").notNull(),     // Display name
  description: text("description"),
  navSection: text("nav_section"),                 // Where in nav this appears
  navIcon: text("nav_icon"),                       // Lucide icon name
  navPath: text("nav_path"),                       // Route path
  dashboardWidget: text("dashboard_widget"),       // Widget component name
  sortOrder: integer("sort_order").notNull().default(0),
  isEnabled: boolean("is_enabled").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  tradeIdx: index("trade_features_trade_idx").on(table.tradeType),
  featureKeyUnique: unique("trade_features_key_unique").on(table.tradeType, table.featureKey),
}));

export const insertTradeFeatureSchema = createInsertSchema(tradeFeatures).omit({ id: true, createdAt: true });
export type InsertTradeFeature = z.infer<typeof insertTradeFeatureSchema>;
export type TradeFeature = typeof tradeFeatures.$inferSelect;

// ============================================
// Object ACL Policy mirror (resilience fallback for GCS metadata)
// ============================================
export const objectAclPolicies = pgTable("object_acl_policies", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  objectKey: text("object_key").notNull().unique(),
  owner: text("owner").notNull(),
  organizationId: text("organization_id").notNull(),
  visibility: text("visibility").notNull().default("private"),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  objectKeyIdx: index("object_acl_policies_object_key_idx").on(table.objectKey),
  orgIdx: index("object_acl_policies_org_idx").on(table.organizationId),
}));

export const insertObjectAclPolicySchema = createInsertSchema(objectAclPolicies).omit({ id: true, updatedAt: true });
export type InsertObjectAclPolicy = z.infer<typeof insertObjectAclPolicySchema>;

// Which DOTs an organization regularly bids in (drives onboarding & default spec book picker)
export const organizationDotPreferences = pgTable("organization_dot_preferences", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  agencyId: varchar("agency_id").notNull().references(() => dotAgencies.id, { onDelete: "cascade" }),
  isDefault: boolean("is_default").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  uniquePref: unique("org_dot_preferences_uniq").on(table.organizationId, table.agencyId),
  orgIdx: index("org_dot_preferences_org_idx").on(table.organizationId),
}));
export const insertOrganizationDotPreferenceSchema = createInsertSchema(organizationDotPreferences).omit({ id: true, createdAt: true });
export type InsertOrganizationDotPreference = z.infer<typeof insertOrganizationDotPreferenceSchema>;
export type OrganizationDotPreference = typeof organizationDotPreferences.$inferSelect;