// AUTO-GENERATED SPLIT FROM shared/schema/features.ts (Task #2426).
// Domain bucketing rule lives in shared/schema/features/index.ts.
import { sql } from "drizzle-orm";
import { pgTable, text, varchar, boolean, timestamp, date, decimal, integer, pgEnum, doublePrecision, index, unique, uniqueIndex, json, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod";
import { addendumRecipientTypeEnum, addendumStatusEnum, aiBidDocumentAnalysisStatusEnum, aiCoDraftStatusEnum, aiContractDocumentAnalysisStatusEnum, contractStatusEnum, contractTypeEnum, contractRedlineStatusEnum, contractApprovalDecisionEnum, clauseCategoryEnum, signatureRequestStatusEnum, signerStatusEnum, aiInsightModuleEnum, aiInsightSeverityEnum, aiTakeoffModeEnum, aiTakeoffStatusEnum, aiTakeoffSuggestionStatusEnum, aiTakeoffRejectReasonEnum, aiTaskPriorityEnum, aiTaskStatusEnum, approvalEntityTypeEnum, approvalStatusEnum, atsProviderEnum, bidEquipmentSourceEnum, bidInvitationStatusEnum, bidRequestStatusEnum, bidResponseStatusEnum, blogCommentStatusEnum, blogPostStatusEnum, conversationTypeEnum, crewAvailabilityStatusEnum, crmActivityTypeEnum, crmCallDirectionEnum, crmCallOutcomeEnum, crmCallStatusEnum, crmCustomFieldEntityEnum, crmCustomFieldTypeEnum, crmContactRoleEnum, crmNoteTypeEnum, crmOrgStatusEnum, crmOrganisationTypeEnum, crmPipelineStageEnum, crmPreferredContactEnum, crmLostCategoryEnum, crmQuoteAcceptanceStatusEnum, crmLeadScoringOperatorEnum, crmSequenceStatusEnum, crmSequenceStepTypeEnum, crmSequenceEnrollmentStatusEnum, crmSequenceExecutionStatusEnum, crmSequenceEmailEventTypeEnum, crmSequenceExitReasonEnum, crmQuoteApprovalStatusEnum, dataSubjectRequestStatusEnum, dataSubjectRequestTypeEnum, documentRevisionSourceEnum, documentRevisionStatusEnum, emailClassificationEnum, emailProviderEnum, emailTaskSourceEnum, emailThreadStatusEnum, hiringActivityTypeEnum, hiringCandidateStageEnum, hiringCompensationTypeEnum, hiringEmploymentTypeEnum, hiringInterviewStatusEnum, hiringJobStatusEnum, hiringSyncStatusEnum, hustlerDelegateRoleEnum, hustlerLinkRequestStatusEnum, installationStatusEnum, lidarScanStatusEnum, lidarAnnotationTypeEnum, lidarComparisonTypeEnum, unifiedPaymentMethodEnum, unifiedPaymentStatusEnum, invoiceTypeEnum, integrationConnectionStatusEnum, integrationEventStatusEnum, integrationProviderEnum, issueSeverityEnum, issueStatusEnum, jobsiteAnalysisStatusEnum, lienWaiverStatusEnum, lienWaiverTypeEnum, locationLevelEnum, maintenanceTypeEnum, measurementReviewStatusEnum, measurementSourceEnum, measurementStatusEnum, measurementTypeEnum, takeoffVersionStatusEnum, messageEntityTypeEnum, mobilePlatformEnum, offlineEntityTypeEnum, offlineOperationTypeEnum, offlineSyncStatusEnum, organizationDocumentTypeEnum, organizationDocumentVisibilityEnum, overheadCostActionEnum, overheadCostCategoryEnum, overheadCostFrequencyEnum, portalChatPriorityEnum, portalChatThreadCategoryEnum, portalChatThreadStatusEnum, pricebookImportJobStatusEnum, pricebookStatusEnum, pricingApprovalStatusEnum, pricingSourceTypeEnum, projectEquipmentPlanStatusEnum, repairStatusEnum, retentionActionEnum, retentionEntityTypeEnum, rewardTypeEnum, rfiCategoryEnum, rfiPriorityEnum, rfiStatusEnum, scheduleDependencyTypeEnum, scheduleGeneratedByEnum, scheduleTaskStatusEnum, socialAccountStatusEnum, socialPlatformEnum, socialPostStatusEnum, sovPaymentMethodEnum, sovStatusEnum, storedMaterialStatusEnum, retentionReleaseTypeEnum, retentionReleaseStatusEnum, sowAuditActionEnum, ssoProviderEnum, submittalCategoryEnum, submittalItemStatusEnum, submittalPhaseEnum, submittalReviewRoleEnum, submittalReviewStatusEnum, submittalStatusEnum, submittalTypeEnum, syncStatusEnum, tradeTypeEnum, transmittalStatusEnum, userRoleEnum, vendorEnrollmentStatusEnum, voiceLogStatusEnum, websiteDeploymentActionEnum, websitePageTypeEnum, websiteProjectStatusEnum, websiteStatusEnum, takeoffIssueCategoryEnum, takeoffIssueStatusEnum, talentAvailabilityEnum, talentProfileVisibilityEnum, workflowEntityTypeEnum, riskCategoryEnum, riskStatusEnum, workflowTemplateStatusEnum, workflowInstanceStatusEnum, videoCallStatusEnum, workflowNotificationChannelEnum, dotAgencyKindEnum, dotPayItemTypeEnum, dbeCertificationTypeEnum, suretyBondTypeEnum, suretyBondStatusEnum, haulTicketStatusEnum, swpppInspectionTypeEnum, idrStatusEnum, buyAmericaStatusEnum } from "../enums";
import { bids, organizations, projects, users } from "../core";
import { changeOrders, estimateLineItems, estimates, planDocuments, projectInspections, tasks, tmTickets } from "../operations";



// ==========================================
// Libraries System - Items, Assemblies, Custom Libraries
// ==========================================

export const customLibraries = pgTable("custom_libraries", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 120 }).notNull(),
  description: text("description"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  orgIdx: index("custom_libraries_org_idx").on(table.organizationId),
}));

export const insertCustomLibrarySchema = createInsertSchema(customLibraries).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertCustomLibrary = z.infer<typeof insertCustomLibrarySchema>;
export type CustomLibrary = typeof customLibraries.$inferSelect;

// Task #2068 — three-tier catalog: Trade > Category > Item.
// `library_categories` is the middle "Category" tier. Each category belongs to
// an organization and (optionally) a custom library and a trade. Library items
// link to a category via `categoryId` and carry the top-level `tradeType`.
export const libraryCategories = pgTable("library_categories", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  libraryId: varchar("library_id").references(() => customLibraries.id, { onDelete: "set null" }),
  tradeType: varchar("trade_type", { length: 60 }),
  name: varchar("name", { length: 120 }).notNull(),
  description: text("description"),
  displayOrder: integer("display_order").notNull().default(0),
  sourceId: varchar("source_id"),
  isPrebuilt: boolean("is_prebuilt").notNull().default(false),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  orgIdx: index("library_categories_org_idx").on(table.organizationId),
  tradeIdx: index("library_categories_trade_idx").on(table.tradeType),
  libraryIdx: index("library_categories_library_idx").on(table.libraryId),
}));

export const insertLibraryCategorySchema = createInsertSchema(libraryCategories).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertLibraryCategory = z.infer<typeof insertLibraryCategorySchema>;
export type LibraryCategory = typeof libraryCategories.$inferSelect;

export const libraryItems = pgTable("library_items", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 120 }).notNull(),
  itemNumber: varchar("item_number", { length: 50 }),
  measuredCoverage: doublePrecision("measured_coverage").notNull().default(1),
  unitOfMeasure: varchar("unit_of_measure", { length: 20 }).notNull(),
  purchaseCoverage: doublePrecision("purchase_coverage").notNull().default(1),
  purchaseUnit: varchar("purchase_unit", { length: 50 }).notNull(),
  description: varchar("description", { length: 255 }),
  costTypes: text("cost_types").array().notNull().default(sql`ARRAY['material']::text[]`),
  accountingCodes: json("accounting_codes"),
  unitCosts: json("unit_costs"),
  notes: text("notes"),
  libraryId: varchar("library_id").references(() => customLibraries.id, { onDelete: "set null" }),
  // Task #2068 — top "Trade" tier (string so we can store any tradeType enum
  // value without coupling library_items to the exact enum membership).
  tradeType: varchar("trade_type", { length: 60 }),
  // Task #2068 — middle "Category" tier; nullable so legacy items remain valid
  // until they're sorted into a category.
  categoryId: varchar("category_id").references(() => libraryCategories.id, { onDelete: "set null" }),
  sourceId: varchar("source_id"),
  isPrebuilt: boolean("is_prebuilt").notNull().default(false),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  orgIdx: index("library_items_org_idx").on(table.organizationId),
  libraryIdx: index("library_items_library_idx").on(table.libraryId),
  tradeIdx: index("library_items_trade_idx").on(table.tradeType),
  categoryIdx: index("library_items_category_idx").on(table.categoryId),
}));

export const insertLibraryItemSchema = createInsertSchema(libraryItems).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertLibraryItem = z.infer<typeof insertLibraryItemSchema>;
export type LibraryItem = typeof libraryItems.$inferSelect;

export const libraryAssemblies = pgTable("library_assemblies", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 120 }).notNull(),
  assemblyNumber: varchar("assembly_number", { length: 50 }),
  unitOfMeasure: varchar("unit_of_measure", { length: 20 }).notNull(),
  description: varchar("description", { length: 255 }),
  libraryId: varchar("library_id").references(() => customLibraries.id, { onDelete: "set null" }),
  sourceId: varchar("source_id"),
  isPrebuilt: boolean("is_prebuilt").notNull().default(false),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  orgIdx: index("library_assemblies_org_idx").on(table.organizationId),
  libraryIdx: index("library_assemblies_library_idx").on(table.libraryId),
}));

export const insertLibraryAssemblySchema = createInsertSchema(libraryAssemblies).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertLibraryAssembly = z.infer<typeof insertLibraryAssemblySchema>;
export type LibraryAssembly = typeof libraryAssemblies.$inferSelect;

export const libraryAssemblyItems = pgTable("library_assembly_items", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  assemblyId: varchar("assembly_id").notNull().references(() => libraryAssemblies.id, { onDelete: "cascade" }),
  itemId: varchar("item_id").references(() => libraryItems.id, { onDelete: "set null" }),
  name: text("name").notNull(),
  formula: text("formula").notNull().default("1"),
  wasteFactor: doublePrecision("waste_factor").notNull().default(0),
  unitCost: decimal("unit_cost", { precision: 10, scale: 2 }),
  unit: varchar("unit", { length: 20 }),
  displayOrder: integer("display_order").notNull().default(0),
}, (table) => ({
  assemblyIdx: index("library_assembly_items_assembly_idx").on(table.assemblyId),
}));

export const insertLibraryAssemblyItemSchema = createInsertSchema(libraryAssemblyItems).omit({ id: true });
export type InsertLibraryAssemblyItem = z.infer<typeof insertLibraryAssemblyItemSchema>;
export type LibraryAssemblyItem = typeof libraryAssemblyItems.$inferSelect;

export const libraryAssemblyItemGroups = pgTable("library_assembly_item_groups", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  assemblyId: varchar("assembly_id").notNull().references(() => libraryAssemblies.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 120 }).notNull(),
  description: text("description"),
  displayOrder: integer("display_order").notNull().default(0),
}, (table) => ({
  assemblyIdx: index("library_assembly_item_groups_assembly_idx").on(table.assemblyId),
}));

export const insertLibraryAssemblyItemGroupSchema = createInsertSchema(libraryAssemblyItemGroups).omit({ id: true });
export type InsertLibraryAssemblyItemGroup = z.infer<typeof insertLibraryAssemblyItemGroupSchema>;
export type LibraryAssemblyItemGroup = typeof libraryAssemblyItemGroups.$inferSelect;

export const libraryAssemblyItemGroupMembers = pgTable("library_assembly_item_group_members", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  groupId: varchar("group_id").notNull().references(() => libraryAssemblyItemGroups.id, { onDelete: "cascade" }),
  itemId: varchar("item_id").references(() => libraryItems.id, { onDelete: "set null" }),
  name: text("name").notNull(),
  formula: text("formula").notNull().default("1"),
  displayOrder: integer("display_order").notNull().default(0),
}, (table) => ({
  groupIdx: index("library_assembly_group_members_group_idx").on(table.groupId),
}));

export const insertLibraryAssemblyItemGroupMemberSchema = createInsertSchema(libraryAssemblyItemGroupMembers).omit({ id: true });
export type InsertLibraryAssemblyItemGroupMember = z.infer<typeof insertLibraryAssemblyItemGroupMemberSchema>;
export type LibraryAssemblyItemGroupMember = typeof libraryAssemblyItemGroupMembers.$inferSelect;