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



// ========================================================================
// HEAVY CIVIL & DOT COVERAGE
// Pay item libraries for FHWA + all 50+ state DOTs / territories /
// toll authorities, plus the surrounding heavy-civil tables (DBE goals,
// surety bonds, haul tickets, Daily Inspector Reports, SWPPP, Buy America).
// Pay item libraries are GLOBAL reference data (no organizationId);
// orgs may add overrides via dotPayItemOverrides.
// ========================================================================

export const dotAgencies = pgTable("dot_agencies", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  code: varchar("code", { length: 32 }).notNull().unique(),
  name: text("name").notNull(),
  fullName: text("full_name").notNull(),
  stateCode: varchar("state_code", { length: 4 }),
  kind: dotAgencyKindEnum("kind").notNull(),
  website: text("website"),
  specBookSystem: text("spec_book_system"),
  currentSpecYear: varchar("current_spec_year", { length: 8 }),
  supportsAashtoware: boolean("supports_aashtoware").notNull().default(false),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  kindIdx: index("dot_agencies_kind_idx").on(table.kind),
  stateIdx: index("dot_agencies_state_idx").on(table.stateCode),
}));
export const insertDotAgencySchema = createInsertSchema(dotAgencies).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertDotAgency = z.infer<typeof insertDotAgencySchema>;
export type DotAgency = typeof dotAgencies.$inferSelect;

export const dotSpecBooks = pgTable("dot_spec_books", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  agencyId: varchar("agency_id").notNull().references(() => dotAgencies.id, { onDelete: "cascade" }),
  edition: varchar("edition", { length: 16 }).notNull(),
  title: text("title").notNull(),
  effectiveDate: date("effective_date"),
  isCurrent: boolean("is_current").notNull().default(false),
  itemCount: integer("item_count").notNull().default(0),
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  agencyIdx: index("dot_spec_books_agency_idx").on(table.agencyId),
  uniqueEdition: unique("dot_spec_books_agency_edition_uniq").on(table.agencyId, table.edition),
}));
export const insertDotSpecBookSchema = createInsertSchema(dotSpecBooks).omit({ id: true, createdAt: true, updatedAt: true, itemCount: true });
export type InsertDotSpecBook = z.infer<typeof insertDotSpecBookSchema>;
export type DotSpecBook = typeof dotSpecBooks.$inferSelect;

export const dotPayItems = pgTable("dot_pay_items", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  specBookId: varchar("spec_book_id").notNull().references(() => dotSpecBooks.id, { onDelete: "cascade" }),
  agencyId: varchar("agency_id").notNull().references(() => dotAgencies.id, { onDelete: "cascade" }),
  itemNumber: varchar("item_number", { length: 64 }).notNull(),
  description: text("description").notNull(),
  unit: varchar("unit", { length: 16 }).notNull(),
  specSection: varchar("spec_section", { length: 32 }),
  category: text("category"),
  payItemType: dotPayItemTypeEnum("pay_item_type").notNull().default("UNIT_PRICE"),
  searchTokens: text("search_tokens"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  specBookIdx: index("dot_pay_items_spec_book_idx").on(table.specBookId),
  agencyIdx: index("dot_pay_items_agency_idx").on(table.agencyId),
  itemNumberIdx: index("dot_pay_items_item_number_idx").on(table.itemNumber),
  uniqueItem: unique("dot_pay_items_spec_book_item_uniq").on(table.specBookId, table.itemNumber),
}));
export const insertDotPayItemSchema = createInsertSchema(dotPayItems).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertDotPayItem = z.infer<typeof insertDotPayItemSchema>;
export type DotPayItem = typeof dotPayItems.$inferSelect;

// Per-organization overrides: rename, custom unit, internal alias, custom category
export const dotPayItemOverrides = pgTable("dot_pay_item_overrides", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  payItemId: varchar("pay_item_id").notNull().references(() => dotPayItems.id, { onDelete: "cascade" }),
  customDescription: text("custom_description"),
  customUnit: varchar("custom_unit", { length: 16 }),
  internalAlias: text("internal_alias"),
  customCategory: text("custom_category"),
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  uniquePerOrg: unique("dot_pay_item_overrides_org_item_uniq").on(table.organizationId, table.payItemId),
  orgIdx: index("dot_pay_item_overrides_org_idx").on(table.organizationId),
}));
export const insertDotPayItemOverrideSchema = createInsertSchema(dotPayItemOverrides).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertDotPayItemOverride = z.infer<typeof insertDotPayItemOverrideSchema>;
export type DotPayItemOverride = typeof dotPayItemOverrides.$inferSelect;

// Task #1164 — record accept/reject decisions on auto-suggested DOT pay items
// during bid-tab import so the matcher can boost frequently-used items per
// org (and ideally per agency). Each row captures one decision the user made
// for one row of one bid tab. We store the *normalized* description (lower,
// collapsed whitespace, trimmed) so we can group "ASPHALT CONCRETE TYPE B"
// and "asphalt concrete type b" together. agency_id is captured for
// per-agency boosting; it can be null when the match used spec-book/agency
// resolution that didn't surface the agency at decision time.
export const dotPayItemMatchHistory = pgTable("dot_pay_item_match_history", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  agencyId: varchar("agency_id").references(() => dotAgencies.id, { onDelete: "set null" }),
  payItemId: varchar("pay_item_id").notNull().references(() => dotPayItems.id, { onDelete: "cascade" }),
  descriptionNormalized: text("description_normalized").notNull(),
  descriptionRaw: text("description_raw").notNull(),
  accepted: boolean("accepted").notNull(),
  userId: varchar("user_id").references(() => users.id, { onDelete: "set null" }),
  // Task #1247 — every row recorded by a single bid-tab import shares a
  // batch_id so the user can one-click "undo" the whole batch from a toast
  // right after the import completes. Nullable for back-compat with rows
  // recorded before this column existed.
  batchId: varchar("batch_id"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  orgDescIdx: index("dot_pay_item_match_history_org_desc_idx").on(table.organizationId, table.descriptionNormalized),
  orgItemIdx: index("dot_pay_item_match_history_org_item_idx").on(table.organizationId, table.payItemId),
  orgAgencyIdx: index("dot_pay_item_match_history_org_agency_idx").on(table.organizationId, table.agencyId),
  orgBatchIdx: index("dot_pay_item_match_history_org_batch_idx").on(table.organizationId, table.batchId),
}));
export const insertDotPayItemMatchHistorySchema = createInsertSchema(dotPayItemMatchHistory).omit({ id: true, createdAt: true });
export type InsertDotPayItemMatchHistory = z.infer<typeof insertDotPayItemMatchHistorySchema>;
export type DotPayItemMatchHistory = typeof dotPayItemMatchHistory.$inferSelect;

// Task #1743 — per-user × per-spec-book picker filter memory for the DOT
// pay-item picker. Promoted off the device-local
// `dot-pay-item-picker:facets:<uid>:<specBookId>` localStorage key flagged
// by docs/per-user-localstorage-audit.md so an estimator's chosen
// categories + spec sections follow them across devices. This needs a
// dedicated table (rather than a `users.*` column) because the preference
// is two-dimensional (user × DOT spec book) and naturally unbounded as
// estimators visit more spec books.
export const dotPayItemPickerFacets = pgTable("dot_pay_item_picker_facets", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  specBookId: varchar("spec_book_id").notNull().references(() => dotSpecBooks.id, { onDelete: "cascade" }),
  categories: text("categories").array().notNull().default(sql`ARRAY[]::text[]`),
  specSections: text("spec_sections").array().notNull().default(sql`ARRAY[]::text[]`),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  uniquePerUserSpecBook: unique("dot_pay_item_picker_facets_user_spec_book_uniq").on(table.userId, table.specBookId),
  userIdx: index("dot_pay_item_picker_facets_user_idx").on(table.userId),
}));
export const insertDotPayItemPickerFacetsSchema = createInsertSchema(dotPayItemPickerFacets).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertDotPayItemPickerFacets = z.infer<typeof insertDotPayItemPickerFacetsSchema>;
export type DotPayItemPickerFacets = typeof dotPayItemPickerFacets.$inferSelect;

// ============================================
// DBE / MBE / WBE / SBE / VOSB GOAL TRACKING
// ============================================
export const projectDbeGoals = pgTable("project_dbe_goals", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  certificationType: dbeCertificationTypeEnum("certification_type").notNull(),
  goalPercent: decimal("goal_percent", { precision: 5, scale: 2 }).notNull(),
  goalDollars: decimal("goal_dollars", { precision: 14, scale: 2 }),
  actualPercent: decimal("actual_percent", { precision: 5, scale: 2 }),
  actualDollars: decimal("actual_dollars", { precision: 14, scale: 2 }),
  notes: text("notes"),
  createdById: varchar("created_by_id").references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  projectIdx: index("project_dbe_goals_project_idx").on(table.projectId),
  uniqueGoal: unique("project_dbe_goals_uniq").on(table.projectId, table.certificationType),
}));
export const insertProjectDbeGoalSchema = createInsertSchema(projectDbeGoals).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertProjectDbeGoal = z.infer<typeof insertProjectDbeGoalSchema>;
export type ProjectDbeGoal = typeof projectDbeGoals.$inferSelect;

// CRM organisation certifications (multi-cert per sub/vendor)
export const crmOrganisationCertifications = pgTable("crm_organisation_certifications", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  crmOrganisationId: varchar("crm_organisation_id").notNull().references(() => crmOrganisations.id, { onDelete: "cascade" }),
  certificationType: dbeCertificationTypeEnum("certification_type").notNull(),
  certifyingAgency: text("certifying_agency"),
  certificationNumber: text("certification_number"),
  effectiveDate: date("effective_date"),
  expirationDate: date("expiration_date"),
  documentUrl: text("document_url"),
  // Task #491 — link to the org-scoped plan_documents row that owns the
  // upload + revision history for this certification. `documentUrl` stays
  // for backwards compatibility with existing rows; new uploads write
  // through the planDocuments + document_revisions versioning system.
  documentId: varchar("document_id").references(() => planDocuments.id, { onDelete: "set null" }),
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  orgEntityIdx: index("crm_org_cert_entity_idx").on(table.crmOrganisationId),
  expIdx: index("crm_org_cert_exp_idx").on(table.expirationDate),
  uniqueCert: unique("crm_org_cert_uniq").on(table.crmOrganisationId, table.certificationType, table.certifyingAgency),
}));
export const insertCrmOrganisationCertificationSchema = createInsertSchema(crmOrganisationCertifications).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertCrmOrganisationCertification = z.infer<typeof insertCrmOrganisationCertificationSchema>;
export type CrmOrganisationCertification = typeof crmOrganisationCertifications.$inferSelect;

// ============================================
// SURETY BONDS LEDGER
// ============================================
export const suretyBonds = pgTable("surety_bonds", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  projectId: varchar("project_id").references(() => projects.id, { onDelete: "set null" }),
  bidId: varchar("bid_id").references(() => bids.id, { onDelete: "set null" }),
  bondType: suretyBondTypeEnum("bond_type").notNull(),
  status: suretyBondStatusEnum("status").notNull().default("DRAFT"),
  bondNumber: text("bond_number").notNull(),
  suretyCompany: text("surety_company").notNull(),
  agentName: text("agent_name"),
  agentPhone: text("agent_phone"),
  agentEmail: text("agent_email"),
  bondAmount: decimal("bond_amount", { precision: 14, scale: 2 }).notNull(),
  premiumAmount: decimal("premium_amount", { precision: 12, scale: 2 }),
  effectiveDate: date("effective_date"),
  expirationDate: date("expiration_date"),
  releaseDate: date("release_date"),
  documentUrl: text("document_url"),
  documentId: varchar("document_id"),
  notes: text("notes"),
  verificationStatus: text("verification_status"),
  lastVerifiedAt: timestamp("last_verified_at"),
  createdById: varchar("created_by_id").references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  orgIdx: index("surety_bonds_org_idx").on(table.organizationId),
  projectIdx: index("surety_bonds_project_idx").on(table.projectId),
  bidIdx: index("surety_bonds_bid_idx").on(table.bidId),
  expIdx: index("surety_bonds_exp_idx").on(table.expirationDate),
  statusIdx: index("surety_bonds_status_idx").on(table.status),
}));
export const insertSuretyBondSchema = createInsertSchema(suretyBonds).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertSuretyBond = z.infer<typeof insertSuretyBondSchema>;
export type SuretyBond = typeof suretyBonds.$inferSelect;

// ============================================
// HAUL TICKETS
// ============================================
export const haulTickets = pgTable("haul_tickets", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  ticketNumber: text("ticket_number").notNull(),
  ticketDate: date("ticket_date").notNull(),
  status: haulTicketStatusEnum("status").notNull().default("SUBMITTED"),
  materialClass: text("material_class").notNull(),
  source: text("source"),
  destination: text("destination"),
  truckNumber: text("truck_number"),
  driverName: text("driver_name"),
  haulerVendorId: varchar("hauler_vendor_id").references(() => crmOrganisations.id, { onDelete: "set null" }),
  quantity: decimal("quantity", { precision: 12, scale: 3 }).notNull(),
  unit: varchar("unit", { length: 16 }).notNull().default("TON"),
  unitCost: decimal("unit_cost", { precision: 12, scale: 4 }),
  totalCost: decimal("total_cost", { precision: 14, scale: 2 }),
  costCode: varchar("cost_code", { length: 20 }),
  payItemId: varchar("pay_item_id").references(() => dotPayItems.id, { onDelete: "set null" }),
  payItemNumber: varchar("pay_item_number", { length: 64 }),
  ticketPhotoUrl: text("ticket_photo_url"),
  ticketPhotoDocumentId: varchar("ticket_photo_document_id"),
  notes: text("notes"),
  recordedById: varchar("recorded_by_id").references(() => users.id),
  approvedById: varchar("approved_by_id").references(() => users.id),
  approvedAt: timestamp("approved_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  orgIdx: index("haul_tickets_org_idx").on(table.organizationId),
  projectIdx: index("haul_tickets_project_idx").on(table.projectId),
  ticketDateIdx: index("haul_tickets_date_idx").on(table.ticketDate),
  statusIdx: index("haul_tickets_status_idx").on(table.status),
}));
export const insertHaulTicketSchema = createInsertSchema(haulTickets).omit({ id: true, createdAt: true, updatedAt: true, approvedAt: true });
export type InsertHaulTicket = z.infer<typeof insertHaulTicketSchema>;
export type HaulTicket = typeof haulTickets.$inferSelect;

// ============================================
// DAILY INSPECTOR REPORT (IDR)
// Separate from T&M tickets — a state-DOT-style daily field report
// ============================================
export const dailyInspectorReports = pgTable("daily_inspector_reports", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  reportDate: date("report_date").notNull(),
  reportNumber: text("report_number"),
  status: idrStatusEnum("status").notNull().default("DRAFT"),
  inspectorId: varchar("inspector_id").references(() => users.id),
  inspectorName: text("inspector_name"),
  weatherConditions: text("weather_conditions"),
  temperatureHigh: integer("temperature_high"),
  temperatureLow: integer("temperature_low"),
  precipitationInches: decimal("precipitation_inches", { precision: 5, scale: 2 }),
  windSpeedMph: integer("wind_speed_mph"),
  crewCount: integer("crew_count").default(0),
  crewHours: decimal("crew_hours", { precision: 8, scale: 2 }).default("0"),
  equipmentSummary: json("equipment_summary"),
  workPerformed: text("work_performed"),
  stationsWorked: text("stations_worked"),
  deliveries: text("deliveries"),
  visitors: text("visitors"),
  safetyIncidents: text("safety_incidents"),
  delaysEncountered: text("delays_encountered"),
  photoUrls: text("photo_urls").array(),
  attachmentUrls: text("attachment_urls").array(),
  photoDocumentIds: text("photo_document_ids").array(),
  attachmentDocumentIds: text("attachment_document_ids").array(),
  submittedAt: timestamp("submitted_at"),
  approvedAt: timestamp("approved_at"),
  approvedById: varchar("approved_by_id").references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  orgIdx: index("idr_org_idx").on(table.organizationId),
  projectIdx: index("idr_project_idx").on(table.projectId),
  reportDateIdx: index("idr_date_idx").on(table.reportDate),
  uniqueDay: unique("idr_project_date_uniq").on(table.projectId, table.reportDate),
}));
export const insertDailyInspectorReportSchema = createInsertSchema(dailyInspectorReports).omit({ id: true, createdAt: true, updatedAt: true, submittedAt: true, approvedAt: true });
export type InsertDailyInspectorReport = z.infer<typeof insertDailyInspectorReportSchema>;
export type DailyInspectorReport = typeof dailyInspectorReports.$inferSelect;

// ============================================
// DAILY REPORT
// Lightweight daily field report submitted from the mobile DailyReports
// screen (mobile/src/screens/DailyReports.tsx). Distinct from the more
// formal `daily_inspector_reports` IDR. The mobile client posts notes,
// the date, and inline attachments (photos/voice notes) which the sync
// route persists here so office staff can view them on the web.
// ============================================
export const dailyReports = pgTable("daily_reports", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  projectId: varchar("project_id").references(() => projects.id, { onDelete: "set null" }),
  reportDate: date("report_date").notNull(),
  notes: text("notes"),
  weather: text("weather"),
  attachmentsJson: json("attachments_json").$type<Array<{ localId?: string; name?: string; mime?: string; size?: number; objectKey?: string; url?: string }>>().default([]),
  submittedById: varchar("submitted_by_id").references(() => users.id, { onDelete: "set null" }),
  submittedByDeviceId: varchar("submitted_by_device_id"),
  submittedLocalId: varchar("submitted_local_id"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  orgIdx: index("daily_reports_org_idx").on(table.organizationId),
  projectIdx: index("daily_reports_project_idx").on(table.projectId),
  reportDateIdx: index("daily_reports_date_idx").on(table.reportDate),
  localIdUnique: uniqueIndex("daily_reports_org_local_id_uniq").on(table.organizationId, table.submittedLocalId),
}));
export const insertDailyReportSchema = createInsertSchema(dailyReports).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertDailyReport = z.infer<typeof insertDailyReportSchema>;
export type DailyReport = typeof dailyReports.$inferSelect;

// ============================================
// SWPPP / NPDES INSPECTION LOG
// ============================================
export const swpppInspections = pgTable("swppp_inspections", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  inspectionDate: date("inspection_date").notNull(),
  inspectionType: swpppInspectionTypeEnum("inspection_type").notNull().default("ROUTINE"),
  inspectorId: varchar("inspector_id").references(() => users.id),
  inspectorName: text("inspector_name"),
  inspectorCertNumber: text("inspector_cert_number"),
  rainfallTriggerInches: decimal("rainfall_trigger_inches", { precision: 5, scale: 2 }),
  rainfall24hrInches: decimal("rainfall_24hr_inches", { precision: 5, scale: 2 }),
  bmpChecklist: json("bmp_checklist"),
  deficienciesFound: text("deficiencies_found"),
  correctiveActions: text("corrective_actions"),
  correctiveActionAssigneeId: varchar("corrective_action_assignee_id").references(() => users.id),
  correctiveActionDueDate: date("corrective_action_due_date"),
  correctiveActionCompletedAt: timestamp("corrective_action_completed_at"),
  status: text("status").notNull().default("OPEN"),
  resolvedAt: timestamp("resolved_at"),
  resolvedById: varchar("resolved_by_id").references(() => users.id),
  resolutionNotes: text("resolution_notes"),
  photoUrls: text("photo_urls").array(),
  notes: text("notes"),
  // Task #1173: timestamp of the last "corrective action overdue"
  // notification fanout for this inspection. Set by the nightly overdue
  // sweep so the same inspection isn't re-notified every night while it
  // remains OPEN past its due date. Cleared (back to NULL) when the
  // corrective action due date is moved forward or the inspection is
  // re-opened so a fresh overdue cycle can fire if it lapses again.
  lastOverdueNotifiedAt: timestamp("last_overdue_notified_at"),
  // Task #1259: number of FOLLOW-UP overdue reminders already sent for
  // the current overdue cycle. The initial fanout (Task #1173) does
  // NOT increment this — only the daily nudges that come after it do.
  // The sweep stops sending follow-ups once this value reaches
  // SWPPP_OVERDUE_REMINDER_CAP (see jobRunner.ts) or the inspection is
  // RESOLVED. Reset to 0 alongside `lastOverdueNotifiedAt` when the
  // due date moves forward or the inspection is re-opened so a fresh
  // overdue cycle starts from zero. The default of 0 is also the
  // correct backfill value for pre-Task-#1259 rows that already had
  // their initial fanout — they will naturally pick up follow-up #1
  // on the next eligible run.
  overdueReminderCount: integer("overdue_reminder_count").notNull().default(0),
  // Note: the effective cap for overdueReminderCount is the per-org
  // `organizations.swpppOverdueReminderMaxCount`, falling back to the
  // shared default `SWPPP_OVERDUE_REMINDER_DEFAULT_CAP` (in
  // `shared/schema/core.ts`). The UI fetches the effective value from
  // `GET /api/swppp/settings` to render an accurate "Reminder N of M
  // sent" badge alongside the server-side sweep.
  createdById: varchar("created_by_id").references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  orgIdx: index("swppp_org_idx").on(table.organizationId),
  projectIdx: index("swppp_project_idx").on(table.projectId),
  inspectionDateIdx: index("swppp_date_idx").on(table.inspectionDate),
}));
export const insertSwpppInspectionSchema = createInsertSchema(swpppInspections).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertSwpppInspection = z.infer<typeof insertSwpppInspectionSchema>;
export type SwpppInspection = typeof swpppInspections.$inferSelect;

// ============================================
// MATERIAL CERTIFICATIONS / BUY AMERICA TRACKER
// ============================================
export const materialCertifications = pgTable("material_certifications", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  materialDescription: text("material_description").notNull(),
  payItemId: varchar("pay_item_id").references(() => dotPayItems.id, { onDelete: "set null" }),
  payItemNumber: varchar("pay_item_number", { length: 64 }),
  manufacturerName: text("manufacturer_name"),
  manufacturerCountry: text("manufacturer_country"),
  millName: text("mill_name"),
  millCountry: text("mill_country"),
  heatNumber: text("heat_number"),
  certNumber: text("cert_number"),
  buyAmericaStatus: buyAmericaStatusEnum("buy_america_status").notNull().default("PENDING"),
  waiverReason: text("waiver_reason"),
  documentUrl: text("document_url"),
  documentId: varchar("document_id"),
  receivedDate: date("received_date"),
  expirationDate: date("expiration_date"),
  submittedById: varchar("submitted_by_id").references(() => users.id),
  submittedAt: timestamp("submitted_at"),
  verifiedById: varchar("verified_by_id").references(() => users.id),
  verifiedAt: timestamp("verified_at"),
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  orgIdx: index("material_certs_org_idx").on(table.organizationId),
  projectIdx: index("material_certs_project_idx").on(table.projectId),
  statusIdx: index("material_certs_status_idx").on(table.buyAmericaStatus),
}));
export const insertMaterialCertificationSchema = createInsertSchema(materialCertifications).omit({ id: true, createdAt: true, updatedAt: true, verifiedAt: true });
export type InsertMaterialCertification = z.infer<typeof insertMaterialCertificationSchema>;
export type MaterialCertification = typeof materialCertifications.$inferSelect;