import { sql } from "drizzle-orm";
import { pgTable, text, varchar, boolean, timestamp, date, decimal, integer, pgEnum, doublePrecision, index, unique, json, jsonb, type AnyPgColumn } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod";
import { aiNoteInsightCategoryEnum, aiNoteInsightSeverityEnum, aiNoteInsightSourceTypeEnum, aiTaskPriorityEnum, aiTaskStatusEnum, auditActionEnum, billingStatusEnum, calendarEventTypeEnum, changeOrderStatusEnum, clockEventTypeEnum, dailyReportLockStatusEnum, delayClaimStatusEnum, delayClaimTypeEnum, delayNotificationRecipientTypeEnum, delayNotificationStatusEnum, delayReasonEnum, delayResponsibilityEnum, delayStatusEnum, documentTypeEnum, domainEventStatusEnum, dowelSizeEnum, estimateItemCategoryEnum, estimateLineItemSourceEnum, estimateStatusEnum, fileTypeEnum, inspectionRequestMethodEnum, inspectionStatusEnum, inspectionTypeEnum, invoiceMatchStatusEnum, materialResponsibilityEnum, mediaTypeEnum, noteBlockTypeEnum, noteTypeEnum, notificationTypeEnum, birthdayReminderCadenceEnum, overageActionStatusEnum, overtimeRequestStatusEnum, photoCustodyActionEnum, poReceiptItemConditionEnum, poReceiptStatusEnum, procurementStatusEnum, purchaseOrderStatusEnum, purchaseRequestStatusEnum, rebarSizeEnum, salaryTypeEnum, sealerTypeEnum, shiftApprovalStatusEnum, stoneTypeEnum, taskSourceTypeEnum, tmBillingStatusEnum, tmInvoiceStatusEnum, tmTicketStatusEnum, underlaymentTypeEnum, vendorInvoiceStatusEnum, wireMeshTypeEnum, punchListTradeEnum, punchListPriorityEnum, punchListStatusEnum, warrantyCaseTypeEnum, warrantyCaseStatusEnum, warrantyPriorityEnum, warrantyTaskStatusEnum, warrantyDocumentTypeEnum, leaveRequestStatusEnum, handoverItemStatusEnum, handoverSignoffRoleEnum, assetMaintenanceTypeEnum, maintenanceSystemEnum, recurringFrequencyEnum, costSourceCategoryEnum, costOriginModuleEnum, costTransactionStatusEnum, mobilizationChecklistStatusEnum, mobilizationItemStatusEnum, methodStatementStatusEnum, permitStatusEnum, permitTypeEnum, materialTestStatusEnum, materialTestTypeEnum, ppeTypeEnum, ppeComplianceStatusEnum, projectReportTypeEnum, projectReportStatusEnum } from "./enums";
import { userRoleEnum } from "./enums";
import { bids, organizations, projects, users } from "./core";
import { aiRuns, contracts, crmOrganisations, crmTranscriptBackfillJobs, dotPayItems, dotSpecBooks, organizationSowItems, quantityCategories, rfis, scopeWorkTypes } from "./features";

export const bidSubcontractorQuotes = pgTable("bid_subcontractor_quotes", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  bidId: varchar("bid_id").references(() => bids.id, { onDelete: "set null" }),
  projectId: varchar("project_id").references(() => projects.id, { onDelete: "cascade" }),
  subcontractorName: text("subcontractor_name").notNull(),
  scopeOfWork: text("scope_of_work").notNull(),
  quoteAmount: decimal("quote_amount", { precision: 12, scale: 2 }).notNull(),
  leadTime: text("lead_time"),
  estimatedCompletionTime: text("estimated_completion_time"),
  contactName: text("contact_name"),
  contactEmail: text("contact_email"),
  contactPhone: text("contact_phone"),
  inclusions: text("inclusions"),
  exclusions: text("exclusions"),
  notes: text("notes"),
  isSelected: boolean("is_selected").notNull().default(false),
  fileUrl: text("file_url"),
  fileName: text("file_name"),
  fileSize: integer("file_size"),
  mimeType: text("mime_type"),
  rfqSentAt: timestamp("rfq_sent_at"),
  rfqStatus: text("rfq_status"),
  rfqResponseToken: text("rfq_response_token"),
  rfqResponseAttachmentsJson: text("rfq_response_attachments_json"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Bid Material Quotes table
// During conversion: projectId added, bidId set to null when bid deleted
// Non-selected quotes preserved for later selection on project page
export const bidMaterialQuotes = pgTable("bid_material_quotes", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  bidId: varchar("bid_id").references(() => bids.id, { onDelete: "set null" }),
  projectId: varchar("project_id").references(() => projects.id, { onDelete: "cascade" }),
  materialName: text("material_name").notNull(),
  description: text("description").notNull(),
  specs: text("specs"),
  cost: decimal("cost", { precision: 12, scale: 2 }).notNull(),
  leadTime: text("lead_time"), // e.g., "2 weeks", "30 days"
  supplierName: text("supplier_name"),
  supplierContact: text("supplier_contact"),
  supplierEmail: text("supplier_email"),
  isSelected: boolean("is_selected").notNull().default(false), // Selected quote transfers on award
  fileUrl: text("file_url"),
  fileName: text("file_name"),
  fileSize: integer("file_size"),
  mimeType: text("mime_type"),
  rfqSentAt: timestamp("rfq_sent_at"),
  rfqStatus: text("rfq_status"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Estimates table - can attach to either a bid OR project
// During conversion: bidId retained for traceability, projectId added
export const estimates = pgTable("estimates", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  bidId: varchar("bid_id").references(() => bids.id, { onDelete: "set null" }),
  projectId: varchar("project_id").references(() => projects.id, { onDelete: "cascade" }),
  versionNumber: integer("version_number").notNull().default(1),
  status: estimateStatusEnum("status").notNull().default("DRAFT"),
  baseBidAmount: decimal("base_bid_amount", { precision: 12, scale: 2 }),
  altPricesJson: text("alt_prices_json"),
  costBreakdownJson: text("cost_breakdown_json"),
  // Task #2576 — Per-estimate override of org-level estimating factors.
  // When non-null this JSON snapshot wins over `aiEstimatorOrgFactors`
  // for roll-up totals. Audit-logged on every write.
  estimatingFactorsOverride: jsonb("estimating_factors_override"),
  notes: text("notes"),
  createdById: varchar("created_by_id").notNull().references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  // Ensure at least one of bidId or projectId is set (allows both after conversion)
  checkEitherBidOrProject: sql`CHECK ((bid_id IS NULL AND project_id IS NOT NULL) OR (bid_id IS NOT NULL))`,
}));

// Procurement Items table
export const procurementItems = pgTable("procurement_items", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  description: text("description").notNull(),
  vendor: text("vendor"),
  quantity: decimal("quantity", { precision: 10, scale: 2 }),
  unit: text("unit"),
  unitCost: decimal("unit_cost", { precision: 10, scale: 2 }),
  status: procurementStatusEnum("status").notNull().default("PLANNED"),
  poNumber: text("po_number"),
  neededByDate: timestamp("needed_by_date"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Plan Documents scope discriminator (Task #491). PROJECT-scoped docs live
// inside a project (most heavy-civil flows). ORG-scoped docs are owned by
// an organization directly (e.g. CRM organisation certifications, which
// follow the company across many projects).
export const planDocumentScopeEnum = pgEnum("plan_document_scope", ["PROJECT", "ORG"]);

// Plan Documents table — `projectId` is nullable for ORG-scoped documents.
// All rows carry `organizationId` so tenant ownership is recoverable even
// when no project is attached.
export const planDocuments = pgTable("plan_documents", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  scope: planDocumentScopeEnum("scope").notNull().default("PROJECT"),
  projectId: varchar("project_id").references(() => projects.id, { onDelete: "cascade" }),
  organizationId: varchar("organization_id").references(() => organizations.id, { onDelete: "cascade" }),
  type: documentTypeEnum("type").notNull().default("OTHER"),
  title: text("title").notNull(),
  fileName: text("file_name").notNull(),
  fileUrl: text("file_url").notNull(),
  objectKey: text("object_key"),
  fileSize: integer("file_size"),
  mimeType: text("mime_type"),
  uploadedById: varchar("uploaded_by_id").notNull().references(() => users.id),
  uploadedAt: timestamp("uploaded_at").notNull().defaultNow(),
});

export const bidDocuments = pgTable("bid_documents", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  bidId: varchar("bid_id").notNull().references(() => bids.id, { onDelete: "cascade" }),
  type: documentTypeEnum("type").notNull().default("OTHER"),
  title: text("title").notNull(),
  fileName: text("file_name").notNull(),
  fileUrl: text("file_url").notNull(),
  objectKey: text("object_key"),
  fileSize: integer("file_size"),
  mimeType: text("mime_type"),
  uploadedById: varchar("uploaded_by_id").notNull().references(() => users.id),
  uploadedAt: timestamp("uploaded_at").notNull().defaultNow(),
});

export const insertBidDocumentSchema = createInsertSchema(bidDocuments).omit({
  id: true,
  uploadedAt: true,
});
export type InsertBidDocument = z.infer<typeof insertBidDocumentSchema>;
export type BidDocument = typeof bidDocuments.$inferSelect;

// Time Entries table
export const timeEntries = pgTable("time_entries", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  date: timestamp("date").notNull(),
  hoursRegular: decimal("hours_regular", { precision: 8, scale: 2 }).notNull().default("0"),
  hoursOvertime: decimal("hours_overtime", { precision: 8, scale: 2 }).notNull().default("0"),
  costCode: text("cost_code"),
  notes: text("notes"),
  approvalStatus: shiftApprovalStatusEnum("approval_status").notNull().default("PENDING"),
  approvedById: varchar("approved_by_id").references(() => users.id),
  approvedAt: timestamp("approved_at"),
  rejectedById: varchar("rejected_by_id").references(() => users.id),
  rejectedAt: timestamp("rejected_at"),
  rejectionReason: text("rejection_reason"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  userIdIdx: index("time_entries_user_id_idx").on(table.userId),
  projectIdIdx: index("time_entries_project_id_idx").on(table.projectId),
  dateIdx: index("time_entries_date_idx").on(table.date),
  approvalStatusIdx: index("time_entries_approval_status_idx").on(table.approvalStatus),
}));

// Project Labor Rates table - stores default rates and burden multiplier for a project
export const projectLaborRates = pgTable("project_labor_rates", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }).unique(),
  defaultRegularRate: decimal("default_regular_rate", { precision: 10, scale: 2 }).notNull(),
  defaultOvertimeRate: decimal("default_overtime_rate", { precision: 10, scale: 2 }).notNull(),
  burdenMultiplier: decimal("burden_multiplier", { precision: 5, scale: 4 }).notNull().default("1.0000"),
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Project Employee Rate Overrides - stores employee-specific rates per project
export const projectEmployeeRates = pgTable("project_employee_rates", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  regularRate: decimal("regular_rate", { precision: 10, scale: 2 }).notNull(),
  overtimeRate: decimal("overtime_rate", { precision: 10, scale: 2 }).notNull(),
  classificationId: varchar("classification_id"), // Optional link to job classification
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  projectUserUnique: unique().on(table.projectId, table.userId),
}));

// Job Classifications - trades and labor categories (e.g., Carpenter, Electrician, Laborer)
export const jobClassifications = pgTable("job_classifications", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  name: text("name").notNull(), // e.g., "Carpenter", "Electrician", "Laborer"
  code: text("code"), // e.g., "CARP", "ELEC", "LAB"
  description: text("description"),
  defaultRegularRate: decimal("default_regular_rate", { precision: 10, scale: 2 }), // Default shop rate for this classification
  defaultOvertimeRate: decimal("default_overtime_rate", { precision: 10, scale: 2 }),
  isActive: boolean("is_active").notNull().default(true),
  sortOrder: integer("sort_order").default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  orgNameUnique: unique().on(table.organizationId, table.name),
}));

// Employee Classification Assignments - assigns employees to job classifications with rates
export const employeeClassifications = pgTable("employee_classifications", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  classificationId: varchar("classification_id").notNull().references(() => jobClassifications.id, { onDelete: "cascade" }),
  regularRate: decimal("regular_rate", { precision: 10, scale: 2 }).notNull(), // Employee's rate for this classification
  overtimeRate: decimal("overtime_rate", { precision: 10, scale: 2 }).notNull(),
  isPrimary: boolean("is_primary").notNull().default(false), // Is this the employee's primary classification?
  effectiveDate: date("effective_date").notNull().defaultNow(),
  endDate: date("end_date"), // Null means currently active
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  userClassUnique: unique().on(table.userId, table.classificationId),
  userIdIdx: index("employee_classifications_user_id_idx").on(table.userId),
  classIdIdx: index("employee_classifications_class_id_idx").on(table.classificationId),
}));

// Prevailing Wage Rates - stores prevailing wage rates per project per classification
export const prevailingWageRates = pgTable("prevailing_wage_rates", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  classificationId: varchar("classification_id").notNull().references(() => jobClassifications.id, { onDelete: "cascade" }),
  wageRate: decimal("wage_rate", { precision: 10, scale: 2 }).notNull(), // Base wage
  fringeRate: decimal("fringe_rate", { precision: 10, scale: 2 }).notNull().default("0"), // Total fringe benefits
  fringeHealthRate: decimal("fringe_health_rate", { precision: 10, scale: 2 }).notNull().default("0"),
  fringePensionRate: decimal("fringe_pension_rate", { precision: 10, scale: 2 }).notNull().default("0"),
  fringeVacationRate: decimal("fringe_vacation_rate", { precision: 10, scale: 2 }).notNull().default("0"),
  fringeTrainingRate: decimal("fringe_training_rate", { precision: 10, scale: 2 }).notNull().default("0"),
  totalRate: decimal("total_rate", { precision: 10, scale: 2 }).notNull(), // wage + fringe
  overtimeMultiplier: decimal("overtime_multiplier", { precision: 4, scale: 2 }).notNull().default("1.5"),
  effectiveDate: date("effective_date").notNull(),
  expirationDate: date("expiration_date"), // Null means no expiration
  wageDecision: text("wage_decision"), // Reference to wage determination (e.g., "CA-2024-0001")
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  projectClassUnique: unique().on(table.projectId, table.classificationId),
  projectIdIdx: index("prevailing_wage_rates_project_id_idx").on(table.projectId),
}));

// Task #1396: per-project mapping from a DOL feed classification name (as it
// appears in the cached Davis-Bacon decision) to an existing
// `job_classifications` row. Persisting the user's choice means subsequent
// syncs of the same wage decision automatically reuse the chosen mapping
// instead of re-running the case-insensitive name match (which can pick the
// wrong row, e.g. "Carpenter (Group 1)" vs. "Carpenter").
export const dolClassificationMappings = pgTable("dol_classification_mappings", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  dolFeedName: text("dol_feed_name").notNull(),
  classificationId: varchar("classification_id").notNull().references(() => jobClassifications.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  projectFeedUnique: unique().on(table.organizationId, table.projectId, table.dolFeedName),
  projectIdx: index("dol_class_mappings_project_idx").on(table.projectId),
}));

export const insertDolClassificationMappingSchema = createInsertSchema(dolClassificationMappings).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertDolClassificationMapping = z.infer<typeof insertDolClassificationMappingSchema>;
export type DolClassificationMapping = typeof dolClassificationMappings.$inferSelect;

export const annualSalaryCategories = pgTable("annual_salary_categories", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  baseAnnualSalary: decimal("base_annual_salary", { precision: 12, scale: 2 }).notNull(),
  salaryType: salaryTypeEnum("salary_type").default("FIXED"),
  effectiveDate: date("effective_date").notNull().defaultNow(),
  description: text("description"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  orgNameUnique: unique().on(table.organizationId, table.name),
}));

export const burdenRates = pgTable("burden_rates", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  burdenPercentage: decimal("burden_percentage", { precision: 8, scale: 4 }).notNull().default("0"),
  fixedBurdenAmount: decimal("fixed_burden_amount", { precision: 12, scale: 2 }).default("0"),
  taxesPercent: decimal("taxes_percent", { precision: 8, scale: 4 }).default("0"),
  benefitsPercent: decimal("benefits_percent", { precision: 8, scale: 4 }).default("0"),
  insurancePercent: decimal("insurance_percent", { precision: 8, scale: 4 }).default("0"),
  overheadPercent: decimal("overhead_percent", { precision: 8, scale: 4 }).default("0"),
  description: text("description"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  orgNameUnique: unique().on(table.organizationId, table.name),
}));

export const employeeCostAssignments = pgTable("employee_cost_assignments", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  salaryCategoryId: varchar("salary_category_id").notNull().references(() => annualSalaryCategories.id, { onDelete: "cascade" }),
  burdenRateId: varchar("burden_rate_id").references(() => burdenRates.id, { onDelete: "set null" }),
  workingHoursPerYear: integer("working_hours_per_year").notNull().default(2080),
  fullyBurdenedCost: decimal("fully_burdened_cost", { precision: 14, scale: 2 }),
  derivedHourlyRate: decimal("derived_hourly_rate", { precision: 10, scale: 4 }),
  effectiveDate: date("effective_date").notNull().defaultNow(),
  endDate: date("end_date"),
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  userUnique: unique().on(table.userId, table.salaryCategoryId),
  userIdIdx: index("employee_cost_assignments_user_id_idx").on(table.userId),
}));

/**
 * @deprecated LEGACY TABLE — replaced by `tmTickets`.
 * Do NOT add new reads/writes against this table.
 * Existing rows are kept for historical reporting only.
 * Migration path: all new T&M work should use tmTickets + tmTicketLaborEntries/Equipment/Materials.
 * This schema definition is retained solely so Drizzle migrations remain consistent;
 * the table itself will be dropped in a future migration once data has been fully migrated.
 */
export const tmDailySheets = pgTable("tm_daily_sheets", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  date: timestamp("date").notNull(),
  tfrRepName: text("tfr_rep_name").notNull(),
  clientRepName: text("client_rep_name"),
  weather: text("weather"),
  descriptionOfWork: text("description_of_work").notNull(),
  crewSize: integer("crew_size"),
  laborSummaryJson: text("labor_summary_json"),
  equipmentUsedJson: text("equipment_used_json"),
  materialsUsedJson: text("materials_used_json"),
  attachmentsJson: text("attachments_json"),
  clientSignatureName: text("client_signature_name"),
  clientSignatureDate: timestamp("client_signature_date"),
  createdById: varchar("created_by_id").notNull().references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// T&M Ticket Status Enum
export const tmInvoices = pgTable("tm_invoices", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  invoiceNumber: text("invoice_number").notNull(),
  invoiceDate: date("invoice_date").notNull(),
  dueDate: date("due_date"),
  
  // Client/billing info
  clientName: text("client_name").notNull(),
  clientAddress: text("client_address"),
  clientEmail: text("client_email"),
  
  // Totals
  subtotal: decimal("subtotal", { precision: 12, scale: 2 }).notNull().default("0"),
  taxRate: decimal("tax_rate", { precision: 5, scale: 2 }).default("0"),
  taxAmount: decimal("tax_amount", { precision: 12, scale: 2 }).default("0"),
  total: decimal("total", { precision: 12, scale: 2 }).notNull().default("0"),
  
  // Status and workflow
  status: tmInvoiceStatusEnum("status").notNull().default("DRAFT"),
  sentAt: timestamp("sent_at"),
  paidAt: timestamp("paid_at"),
  notes: text("notes"),
  
  // PDF generation
  pdfUrl: text("pdf_url"),
  pdfObjectKey: text("pdf_object_key"),
  
  createdById: varchar("created_by_id").notNull().references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  organizationIdIdx: index("tm_invoices_organization_id_idx").on(table.organizationId),
  projectIdIdx: index("tm_invoices_project_id_idx").on(table.projectId),
  statusIdx: index("tm_invoices_status_idx").on(table.status),
  invoiceDateIdx: index("tm_invoices_invoice_date_idx").on(table.invoiceDate),
}));

// T&M Work Tickets table - comprehensive tracking for time & material work
export const tmTickets = pgTable("tm_tickets", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  ticketNumber: text("ticket_number").notNull(),
  workDate: date("work_date").notNull(),
  tfrRepresentativeId: varchar("tfr_representative_id").notNull().references(() => users.id),
  workOrderReference: text("work_order_reference"),
  
  // Standardized scope of work (matches estimating sheets for production rate tracking)
  organizationSowItemId: varchar("organization_sow_item_id").references(() => organizationSowItems.id, { onDelete: "set null" }),
  workTypeId: varchar("work_type_id").references(() => scopeWorkTypes.id, { onDelete: "set null" }),
  workTypeCode: text("work_type_code"), // Machine-readable code for AI/production tracking
  workTypeName: text("work_type_name"), // Display name e.g. "4\" Sidewalk"
  categoryName: text("category_name"), // Category e.g. "Sidewalk"
  scopeModifierIds: text("scope_modifier_ids"), // JSON array of modifier IDs
  scopeModifierNames: text("scope_modifier_names"), // JSON array of modifier names
  canonicalName: text("canonical_name"), // Full standardized name for tracking
  scopeUnit: text("scope_unit"), // Unit of measure (SF, LF, CY, EA)
  scopeQuantity: decimal("scope_quantity", { precision: 12, scale: 2 }), // Quantity completed
  
  // Freetext description for additional details
  scopeDescription: text("scope_description").notNull(),
  notes: text("notes"),
  status: tmTicketStatusEnum("status").notNull().default("DRAFT"),
  
  // Totals (calculated from line items)
  totalLaborHours: decimal("total_labor_hours", { precision: 10, scale: 2 }).default("0"),
  totalLaborCost: decimal("total_labor_cost", { precision: 12, scale: 2 }).default("0"),
  totalEquipmentCost: decimal("total_equipment_cost", { precision: 12, scale: 2 }).default("0"),
  totalMaterialCost: decimal("total_material_cost", { precision: 12, scale: 2 }).default("0"),
  grandTotal: decimal("grand_total", { precision: 12, scale: 2 }).default("0"),
  
  // Approval workflow
  submittedAt: timestamp("submitted_at"),
  submittedById: varchar("submitted_by_id").references(() => users.id),
  approvedAt: timestamp("approved_at"),
  approvedById: varchar("approved_by_id").references(() => users.id),
  rejectedAt: timestamp("rejected_at"),
  rejectedById: varchar("rejected_by_id").references(() => users.id),
  rejectionReason: text("rejection_reason"),
  
  // Client digital sign-off
  clientSignoffName: text("client_signoff_name"),
  clientSignoffSignature: text("client_signoff_signature"),
  clientSignoffAt: timestamp("client_signoff_at"),

  // Signed document upload
  signedDocumentUrl: text("signed_document_url"),
  signedDocumentFileName: text("signed_document_file_name"),
  signedDocumentObjectKey: text("signed_document_object_key"),
  signedDocumentUploadedAt: timestamp("signed_document_uploaded_at"),
  
  // Billing workflow (Office Manager approval for invoicing)
  billingStatus: tmBillingStatusEnum("billing_status").notNull().default("PENDING"),
  billingApprovedAt: timestamp("billing_approved_at"),
  billingApprovedById: varchar("billing_approved_by_id").references(() => users.id),
  invoiceId: varchar("invoice_id").references(() => tmInvoices.id, { onDelete: "set null" }),
  billedAt: timestamp("billed_at"),
  billingNotes: text("billing_notes"),
  costCode: text("cost_code"),
  
  createdById: varchar("created_by_id").notNull().references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  projectIdIdx: index("tm_tickets_project_id_idx").on(table.projectId),
  statusIdx: index("tm_tickets_status_idx").on(table.status),
  workDateIdx: index("tm_tickets_work_date_idx").on(table.workDate),
  workTypeCodeIdx: index("tm_tickets_work_type_code_idx").on(table.workTypeCode),
  billingStatusIdx: index("tm_tickets_billing_status_idx").on(table.billingStatus),
}));

export const tmTicketScopeModifiers = pgTable("tm_ticket_scope_modifiers", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  ticketId: varchar("ticket_id").notNull().references(() => tmTickets.id, { onDelete: "cascade" }),
  modifierId: varchar("modifier_id").notNull(),
  modifierName: text("modifier_name").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  ticketIdIdx: index("tm_ticket_scope_modifiers_ticket_id_idx").on(table.ticketId),
  uniqueTicketModifier: unique("tm_ticket_scope_modifiers_ticket_modifier_uniq").on(table.ticketId, table.modifierId),
}));

export const changeOrderScopeModifiers = pgTable("change_order_scope_modifiers", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  changeOrderId: varchar("change_order_id").notNull().references(() => changeOrders.id, { onDelete: "cascade" }),
  modifierId: varchar("modifier_id").notNull(),
  modifierName: text("modifier_name").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  changeOrderIdIdx: index("change_order_scope_modifiers_co_id_idx").on(table.changeOrderId),
  uniqueCoModifier: unique("change_order_scope_modifiers_co_modifier_uniq").on(table.changeOrderId, table.modifierId),
}));

// T&M Ticket Labor Entries
export const tmTicketLaborEntries = pgTable("tm_ticket_labor_entries", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  ticketId: varchar("ticket_id").notNull().references(() => tmTickets.id, { onDelete: "cascade" }),
  employeeName: text("employee_name").notNull(),
  position: text("position").notNull(),
  crewMemberCount: integer("crew_member_count").notNull().default(1),
  hoursWorked: decimal("hours_worked", { precision: 6, scale: 2 }).notNull(),
  totalHours: decimal("total_hours", { precision: 8, scale: 2 }).notNull(), // hoursWorked * crewMemberCount
  hourlyRate: decimal("hourly_rate", { precision: 10, scale: 2 }),
  totalCost: decimal("total_cost", { precision: 12, scale: 2 }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  ticketIdIdx: index("tm_ticket_labor_entries_ticket_id_idx").on(table.ticketId),
}));

// T&M Ticket Equipment Entries
export const tmTicketEquipmentEntries = pgTable("tm_ticket_equipment_entries", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  ticketId: varchar("ticket_id").notNull().references(() => tmTickets.id, { onDelete: "cascade" }),
  equipmentType: text("equipment_type").notNull(),
  quantity: integer("quantity").notNull().default(1),
  hoursUsed: decimal("hours_used", { precision: 6, scale: 2 }).notNull(),
  hourlyRate: decimal("hourly_rate", { precision: 10, scale: 2 }),
  totalCost: decimal("total_cost", { precision: 12, scale: 2 }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  ticketIdIdx: index("tm_ticket_equipment_entries_ticket_id_idx").on(table.ticketId),
}));

// T&M Ticket Material Entries
export const tmTicketMaterialEntries = pgTable("tm_ticket_material_entries", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  ticketId: varchar("ticket_id").notNull().references(() => tmTickets.id, { onDelete: "cascade" }),
  materialDescription: text("material_description").notNull(),
  quantity: decimal("quantity", { precision: 12, scale: 2 }).notNull(),
  unit: text("unit").notNull(),
  unitCost: decimal("unit_cost", { precision: 10, scale: 2 }),
  totalCost: decimal("total_cost", { precision: 12, scale: 2 }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  ticketIdIdx: index("tm_ticket_material_entries_ticket_id_idx").on(table.ticketId),
}));

// Receipts table
export const receipts = pgTable("receipts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  userId: varchar("user_id").notNull().references(() => users.id),
  date: timestamp("date").notNull(),
  vendor: text("vendor").notNull(),
  amount: decimal("amount", { precision: 10, scale: 2 }).notNull(),
  category: text("category"),
  fileName: text("file_name").notNull(),
  fileUrl: text("file_url").notNull(),
  objectKey: text("object_key"),
  fileSize: integer("file_size"),
  mimeType: text("mime_type"),
  notes: text("notes"),
  costCode: text("cost_code"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// Project Notes table
export const projectNotes = pgTable("project_notes", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  authorId: varchar("author_id").notNull().references(() => users.id),
  noteType: noteTypeEnum("note_type").notNull().default("GENERAL"),
  text: text("text").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  projectIdIdx: index("project_notes_project_id_idx").on(table.projectId),
  authorIdIdx: index("project_notes_author_id_idx").on(table.authorId),
  createdAtIdx: index("project_notes_created_at_idx").on(table.createdAt),
}));

// Company Daily Notes table (company-wide communications)
export const companyDailyNotes = pgTable("company_daily_notes", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  authorId: varchar("author_id").notNull().references(() => users.id),
  projectId: varchar("project_id").references(() => projects.id, { onDelete: "set null" }),
  text: text("text").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  authorIdIdx: index("company_daily_notes_author_id_idx").on(table.authorId),
  projectIdIdx: index("company_daily_notes_project_id_idx").on(table.projectId),
  createdAtIdx: index("company_daily_notes_created_at_idx").on(table.createdAt),
}));

// AI Note Insights table (stores AI analysis of daily notes)
export const aiNoteInsights = pgTable("ai_note_insights", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  runId: varchar("run_id").notNull().references(() => aiRuns.id),
  sourceType: aiNoteInsightSourceTypeEnum("source_type").notNull(),
  sourceId: varchar("source_id").notNull(),
  projectId: varchar("project_id").references(() => projects.id, { onDelete: "set null" }),
  category: aiNoteInsightCategoryEnum("category").notNull(),
  summary: text("summary").notNull(),
  recommendedActions: text("recommended_actions_json"),
  severity: aiNoteInsightSeverityEnum("severity").notNull().default("MEDIUM"),
  recipients: text("recipients_json"),
  status: aiTaskStatusEnum("status").notNull().default("PENDING"),
  acknowledgedById: varchar("acknowledged_by_id").references(() => users.id),
  acknowledgedAt: timestamp("acknowledged_at"),
  completedById: varchar("completed_by_id").references(() => users.id),
  completedAt: timestamp("completed_at"),
  dismissedById: varchar("dismissed_by_id").references(() => users.id),
  dismissedAt: timestamp("dismissed_at"),
  dismissReason: text("dismiss_reason"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  runIdIdx: index("ai_note_insights_run_id_idx").on(table.runId),
  projectIdIdx: index("ai_note_insights_project_id_idx").on(table.projectId),
  categoryIdx: index("ai_note_insights_category_idx").on(table.category),
  severityIdx: index("ai_note_insights_severity_idx").on(table.severity),
  statusIdx: index("ai_note_insights_status_idx").on(table.status),
}));

// Unified Tasks table (supports manual, email-derived, AI-generated, and system tasks)
export const tasks = pgTable("tasks", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  projectId: varchar("project_id").references(() => projects.id, { onDelete: "set null" }),
  bidId: varchar("bid_id").references(() => bids.id, { onDelete: "set null" }),
  vendorId: varchar("vendor_id").references(() => crmOrganisations.id, { onDelete: "set null" }),
  emailThreadId: varchar("email_thread_id"),
  emailMessageId: varchar("email_message_id"),
  context: varchar("context"),
  hiringCandidateId: varchar("hiring_candidate_id"),
  hiringJobId: varchar("hiring_job_id"),
  title: text("title").notNull(),
  description: text("description"),
  category: aiNoteInsightCategoryEnum("category").notNull().default("OTHER"),
  priority: aiTaskPriorityEnum("priority").notNull().default("MEDIUM"),
  status: aiTaskStatusEnum("status").notNull().default("PENDING"),
  sourceType: taskSourceTypeEnum("source_type").notNull().default("MANUAL"),
  aiMetadata: text("ai_metadata"),
  createdById: varchar("created_by_id").notNull().references(() => users.id),
  assignedToId: varchar("assigned_to_id").references(() => users.id),
  dueDate: timestamp("due_date"),
  acknowledgedById: varchar("acknowledged_by_id").references(() => users.id),
  acknowledgedAt: timestamp("acknowledged_at"),
  completedById: varchar("completed_by_id").references(() => users.id),
  completedAt: timestamp("completed_at"),
  dismissedById: varchar("dismissed_by_id").references(() => users.id),
  dismissedAt: timestamp("dismissed_at"),
  dismissReason: text("dismiss_reason"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  organizationIdIdx: index("tasks_organization_id_idx").on(table.organizationId),
  projectIdIdx: index("tasks_project_id_idx").on(table.projectId),
  assignedToIdIdx: index("tasks_assigned_to_id_idx").on(table.assignedToId),
  statusIdx: index("tasks_status_idx").on(table.status),
  priorityIdx: index("tasks_priority_idx").on(table.priority),
  dueDateIdx: index("tasks_due_date_idx").on(table.dueDate),
  sourceTypeIdx: index("tasks_source_type_idx").on(table.sourceType),
  emailThreadIdIdx: index("tasks_email_thread_id_idx").on(table.emailThreadId),
}));

export const insertTaskSchema = createInsertSchema(tasks).omit({ id: true, createdAt: true, updatedAt: true });
export type Task = typeof tasks.$inferSelect;
export type InsertTask = z.infer<typeof insertTaskSchema>;
export const updateTaskSchema = insertTaskSchema.partial();

export const taskSubtasks = pgTable("task_subtasks", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  taskId: varchar("task_id").notNull().references(() => tasks.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  completed: boolean("completed").notNull().default(false),
  createdById: varchar("created_by_id").notNull().references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  taskIdIdx: index("task_subtasks_task_id_idx").on(table.taskId),
}));

export const insertTaskSubtaskSchema = createInsertSchema(taskSubtasks).omit({ id: true, createdAt: true, updatedAt: true });
export type TaskSubtask = typeof taskSubtasks.$inferSelect;
export type InsertTaskSubtask = z.infer<typeof insertTaskSubtaskSchema>;

export const taskComments = pgTable("task_comments", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  taskId: varchar("task_id").notNull().references(() => tasks.id, { onDelete: "cascade" }),
  content: text("content").notNull(),
  createdById: varchar("created_by_id").notNull().references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  taskIdIdx: index("task_comments_task_id_idx").on(table.taskId),
}));

export const insertTaskCommentSchema = createInsertSchema(taskComments).omit({ id: true, createdAt: true, updatedAt: true });
export type TaskComment = typeof taskComments.$inferSelect;
export type InsertTaskComment = z.infer<typeof insertTaskCommentSchema>;

export const taskAttachments = pgTable("task_attachments", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  taskId: varchar("task_id").notNull().references(() => tasks.id, { onDelete: "cascade" }),
  fileName: text("file_name").notNull(),
  fileUrl: text("file_url").notNull(),
  fileSize: integer("file_size"),
  mimeType: text("mime_type"),
  uploadedById: varchar("uploaded_by_id").notNull().references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  taskIdIdx: index("task_attachments_task_id_idx").on(table.taskId),
}));

export const insertTaskAttachmentSchema = createInsertSchema(taskAttachments).omit({ id: true, createdAt: true });
export type TaskAttachment = typeof taskAttachments.$inferSelect;
export type InsertTaskAttachment = z.infer<typeof insertTaskAttachmentSchema>;

// Material responsibility enum - who is responsible for material overages
export const scopeItems = pgTable("scope_items", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  estimateLineItemId: varchar("estimate_line_item_id").references(() => estimateLineItems.id, { onDelete: "set null" }),
  // Unified SOW Tracking - links to organization's master SOW library for production rate tracking across projects
  organizationSowItemId: varchar("organization_sow_item_id").references(() => organizationSowItems.id, { onDelete: "set null" }),
  subcontractorQuoteId: varchar("subcontractor_quote_id"),
  description: text("description").notNull(),
  unit: text("unit").notNull(),
  totalQuantity: decimal("total_quantity", { precision: 12, scale: 2 }).notNull(),
  completedQuantity: decimal("completed_quantity", { precision: 12, scale: 2 }).notNull().default("0"),
  billedQuantity: decimal("billed_quantity", { precision: 12, scale: 2 }).notNull().default("0"),
  unitPrice: decimal("unit_price", { precision: 10, scale: 2 }),
  billingStatus: billingStatusEnum("billing_status").notNull().default("NOT_READY"),
  lastBilledDate: timestamp("last_billed_date"),
  
  // Estimated material quantities (copied from estimate at project creation)
  estimatedConcreteYards: decimal("estimated_concrete_yards", { precision: 10, scale: 2 }),
  estimatedStoneTons: decimal("estimated_stone_tons", { precision: 10, scale: 2 }),
  estimatedExcavationYards: decimal("estimated_excavation_yards", { precision: 10, scale: 2 }),
  
  // Actual material quantities (recorded during project execution)
  actualConcreteYards: decimal("actual_concrete_yards", { precision: 10, scale: 2 }),
  actualStoneTons: decimal("actual_stone_tons", { precision: 10, scale: 2 }),
  actualExcavationYards: decimal("actual_excavation_yards", { precision: 10, scale: 2 }),
  
  // Material variance tracking
  materialResponsibility: materialResponsibilityEnum("material_responsibility").default("PENDING"),
  overageActionStatus: overageActionStatusEnum("overage_action_status").default("NONE"),
  overageNotes: text("overage_notes"),
  overageResolvedById: varchar("overage_resolved_by_id").references(() => users.id),
  overageResolvedAt: timestamp("overage_resolved_at"),
  
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  // Enforce one-to-one mapping: one scope item per estimate line item
  uniqueEstimateLineItem: unique("scope_items_estimate_line_item_unique").on(table.estimateLineItemId),
  organizationSowItemIdx: index("scope_items_org_sow_item_idx").on(table.organizationSowItemId),
}));

// Daily Scope Progress table - tracks daily quantities completed for each scope item
// Also captures production rate data: labor hours, costs, crew size for historical analysis
export const dailyScopeProgress = pgTable("daily_scope_progress", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  scopeItemId: varchar("scope_item_id").notNull().references(() => scopeItems.id, { onDelete: "cascade" }),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  // Unified SOW Tracking - denormalized for efficient cross-project production rate queries
  organizationSowItemId: varchar("organization_sow_item_id").references(() => organizationSowItems.id, { onDelete: "set null" }),
  workDate: date("work_date").notNull(),
  quantityCompleted: decimal("quantity_completed", { precision: 12, scale: 2 }).notNull(),
  billedQuantity: decimal("billed_quantity", { precision: 12, scale: 2 }).notNull().default("0"),
  billingStatus: billingStatusEnum("billing_status").notNull().default("NOT_READY"),
  billedDate: timestamp("billed_date"),
  billedById: varchar("billed_by_id").references(() => users.id),
  notes: text("notes"),
  
  // Production Rate Tracking - Labor
  laborHours: decimal("labor_hours", { precision: 10, scale: 2 }),
  laborCost: decimal("labor_cost", { precision: 12, scale: 2 }),
  crewSize: integer("crew_size"),
  
  // Production Rate Tracking - Materials
  materialCost: decimal("material_cost", { precision: 12, scale: 2 }),
  
  // Production Rate Tracking - Equipment
  equipmentHours: decimal("equipment_hours", { precision: 10, scale: 2 }),
  equipmentCost: decimal("equipment_cost", { precision: 12, scale: 2 }),
  
  // Computed per-unit metrics (stored for query performance)
  laborHoursPerUnit: decimal("labor_hours_per_unit", { precision: 10, scale: 4 }),
  laborCostPerUnit: decimal("labor_cost_per_unit", { precision: 10, scale: 4 }),
  materialCostPerUnit: decimal("material_cost_per_unit", { precision: 10, scale: 4 }),
  totalCostPerUnit: decimal("total_cost_per_unit", { precision: 10, scale: 4 }),
  
  createdById: varchar("created_by_id").notNull().references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  scopeItemIdIdx: index("daily_scope_progress_scope_item_id_idx").on(table.scopeItemId),
  projectIdIdx: index("daily_scope_progress_project_id_idx").on(table.projectId),
  workDateIdx: index("daily_scope_progress_work_date_idx").on(table.workDate),
  billingStatusIdx: index("daily_scope_progress_billing_status_idx").on(table.billingStatus),
  organizationSowItemIdx: index("daily_scope_progress_org_sow_item_idx").on(table.organizationSowItemId),
}));

// Project Material Budgets table - snapshots bid/estimate material quantities when project is created
// This captures the "target" budget for variance tracking
export const projectMaterialBudgets = pgTable("project_material_budgets", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  scopeItemId: varchar("scope_item_id").notNull().references(() => scopeItems.id, { onDelete: "cascade" }),
  estimateLineItemId: varchar("estimate_line_item_id").references(() => estimateLineItems.id, { onDelete: "set null" }),
  
  // Material description and unit from estimate
  description: text("description").notNull(),
  unit: text("unit").notNull(),
  
  // Budgeted quantities and costs (from estimate at time of project creation)
  budgetedQuantity: decimal("budgeted_quantity", { precision: 12, scale: 2 }).notNull(),
  budgetedUnitCost: decimal("budgeted_unit_cost", { precision: 10, scale: 2 }).notNull().default('0'),
  budgetedTotalCost: decimal("budgeted_total_cost", { precision: 12, scale: 2 }).notNull().default('0'),
  
  // Running actual totals (updated as usage entries are added)
  actualQuantityUsed: decimal("actual_quantity_used", { precision: 12, scale: 2 }).notNull().default('0'),
  actualTotalCost: decimal("actual_total_cost", { precision: 12, scale: 2 }).notNull().default('0'),
  
  // Variance tracking
  varianceQuantity: decimal("variance_quantity", { precision: 12, scale: 2 }).notNull().default('0'),
  variancePercent: decimal("variance_percent", { precision: 6, scale: 2 }).notNull().default('0'),
  
  // Alert thresholds
  alertThresholdPercent: decimal("alert_threshold_percent", { precision: 5, scale: 2 }).notNull().default('90'),
  alertTriggered: boolean("alert_triggered").notNull().default(false),
  alertTriggeredAt: timestamp("alert_triggered_at"),
  
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  projectIdIdx: index("project_material_budgets_project_id_idx").on(table.projectId),
  scopeItemIdIdx: index("project_material_budgets_scope_item_id_idx").on(table.scopeItemId),
  alertTriggeredIdx: index("project_material_budgets_alert_triggered_idx").on(table.alertTriggered),
}));

// Project Material Usage table - tracks actual daily material consumption from field reps
export const projectMaterialUsage = pgTable("project_material_usage", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  scopeItemId: varchar("scope_item_id").notNull().references(() => scopeItems.id, { onDelete: "cascade" }),
  materialBudgetId: varchar("material_budget_id").references(() => projectMaterialBudgets.id, { onDelete: "set null" }),
  dailyScopeProgressId: varchar("daily_scope_progress_id").references(() => dailyScopeProgress.id, { onDelete: "set null" }),
  
  // Usage details
  usageDate: date("usage_date").notNull(),
  description: text("description").notNull(),
  quantityUsed: decimal("quantity_used", { precision: 12, scale: 2 }).notNull(),
  unit: text("unit").notNull(),
  unitCost: decimal("unit_cost", { precision: 10, scale: 2 }).notNull().default('0'),
  totalCost: decimal("total_cost", { precision: 12, scale: 2 }).notNull().default('0'),
  
  // Optional vendor/receipt tracking
  vendorName: text("vendor_name"),
  receiptReference: text("receipt_reference"),
  notes: text("notes"),
  
  // Who entered this record
  createdById: varchar("created_by_id").notNull().references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  projectIdIdx: index("project_material_usage_project_id_idx").on(table.projectId),
  scopeItemIdIdx: index("project_material_usage_scope_item_id_idx").on(table.scopeItemId),
  usageDateIdx: index("project_material_usage_usage_date_idx").on(table.usageDate),
  materialBudgetIdIdx: index("project_material_usage_material_budget_id_idx").on(table.materialBudgetId),
}));

// Media table (photos and videos)
export const media = pgTable("media", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  type: mediaTypeEnum("type").notNull(),
  fileName: text("file_name").notNull(),
  fileUrl: text("file_url").notNull(),
  objectKey: text("object_key"),
  fileSize: integer("file_size"),
  mimeType: text("mime_type"),
  caption: text("caption"),
  uploadedById: varchar("uploaded_by_id").notNull().references(() => users.id),
  uploadedAt: timestamp("uploaded_at").notNull().defaultNow(),
  aiTags: text("ai_tags").array(),
  aiDescription: text("ai_description"),
  aiAnalyzedAt: timestamp("ai_analyzed_at"),
});

// Change Orders table
// Simplified workflow: DRAFT → SUBMITTED → APPROVED/REJECTED
// Task #2461 — `changeOrders` forward-references `orgCostCodes` (defined
// later in this file) and cross-file-references `rfis` (which is in the
// `features` barrel that imports back from `operations`). The `(): AnyPgColumn`
// casts on `linkedRfiId` and `costCodeId` break the column-level cycles and
// the explicit `typeof _changeOrders` annotation on the export pins the
// table-level inference so Drizzle's `PgTableWithColumns<...>` type isn't
// circular (TS7022 / TS7024). Downstream `ChangeOrder` `$inferSelect` is
// preserved because the annotation is the inferred shape.
const _changeOrders = pgTable("change_orders", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  changeOrderNumber: text("change_order_number").notNull(),
  description: text("description").notNull(),
  amount: decimal("amount", { precision: 12, scale: 2 }).notNull(),
  status: changeOrderStatusEnum("status").notNull().default("DRAFT"),
  requestedById: varchar("requested_by_id").notNull().references(() => users.id),
  submittedAt: timestamp("submitted_at"),
  approvedById: varchar("approved_by_id").references(() => users.id),
  approvedAt: timestamp("approved_at"),
  rejectionReason: text("rejection_reason"),
  approvalChainJson: text("approval_chain_json"),
  attachmentsJson: text("attachments_json"),
  clientResponseDueDate: timestamp("client_response_due_date"),
  contractId: varchar("contract_id").references(() => contracts.id, { onDelete: "set null" }),
  linkedTmTicketId: varchar("linked_tm_ticket_id").references(() => tmTickets.id, { onDelete: "set null" }),
  linkedRfiId: varchar("linked_rfi_id").references((): AnyPgColumn => rfis.id, { onDelete: "set null" }),
  voidedAt: timestamp("voided_at"),
  voidedById: varchar("voided_by_id").references(() => users.id, { onDelete: "set null" }),
  voidReason: text("void_reason"),
  // Standardized Scope of Work fields (matches estimating sheets for production rate tracking)
  workTypeId: varchar("work_type_id"),
  workTypeCode: text("work_type_code"),
  workTypeName: text("work_type_name"),
  categoryName: text("category_name"),
  scopeModifierIds: text("scope_modifier_ids"),
  scopeModifierNames: text("scope_modifier_names"),
  canonicalName: text("canonical_name"),
  scopeUnit: text("scope_unit"),
  scopeQuantity: text("scope_quantity"),
  costCodeId: integer("cost_code_id").references((): AnyPgColumn => orgCostCodes.id, { onDelete: "set null" }),
  costBreakdownJson: text("cost_breakdown_json"),
  source: text("source").default("MANUAL"),
  takeoffDeltaJson: text("takeoff_delta_json"),
  overheadPercent: decimal("overhead_percent", { precision: 5, scale: 2 }).default("10"),
  profitPercent: decimal("profit_percent", { precision: 5, scale: 2 }).default("5"),
  subcontractorMarkupPercent: decimal("subcontractor_markup_percent", { precision: 5, scale: 2 }).default("5"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  statusIdx: index("change_orders_status_idx").on(table.status),
  projectIdIdx: index("change_orders_project_id_idx").on(table.projectId),
  workTypeCodeIdx: index("change_orders_work_type_code_idx").on(table.workTypeCode),
}));
export const changeOrders: typeof _changeOrders = _changeOrders;

// Change Order Line Items - Labor Entries
export const changeOrderLaborEntries = pgTable("change_order_labor_entries", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  changeOrderId: varchar("change_order_id").notNull().references(() => changeOrders.id, { onDelete: "cascade" }),
  employeeName: text("employee_name").notNull(),
  position: text("position"),
  hoursWorked: decimal("hours_worked", { precision: 8, scale: 2 }).notNull(),
  hourlyRate: decimal("hourly_rate", { precision: 10, scale: 2 }).notNull(),
  totalCost: decimal("total_cost", { precision: 12, scale: 2 }).notNull(),
});

// Change Order Line Items - Equipment Entries
export const changeOrderEquipmentEntries = pgTable("change_order_equipment_entries", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  changeOrderId: varchar("change_order_id").notNull().references(() => changeOrders.id, { onDelete: "cascade" }),
  equipmentType: text("equipment_type").notNull(),
  description: text("description"),
  quantity: integer("quantity").notNull().default(1),
  hoursUsed: decimal("hours_used", { precision: 8, scale: 2 }).notNull(),
  hourlyRate: decimal("hourly_rate", { precision: 10, scale: 2 }).notNull(),
  totalCost: decimal("total_cost", { precision: 12, scale: 2 }).notNull(),
});

// Change Order Line Items - Material Entries (with vendor pricing integration)
export const changeOrderMaterialEntries = pgTable("change_order_material_entries", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  changeOrderId: varchar("change_order_id").notNull().references(() => changeOrders.id, { onDelete: "cascade" }),
  materialDescription: text("material_description").notNull(),
  category: text("category"), // For vendor catalog lookup (CONCRETE, STONE, REBAR, etc.)
  quantity: decimal("quantity", { precision: 12, scale: 2 }).notNull(),
  unit: text("unit"),
  unitCost: decimal("unit_cost", { precision: 10, scale: 2 }).notNull(),
  totalCost: decimal("total_cost", { precision: 12, scale: 2 }).notNull(),
  vendorPricingId: varchar("vendor_pricing_id"), // Reference to catalog item if applied
});

// Change Order Revisions - tracks history of changes for audit trail
export const changeOrderRevisions = pgTable("change_order_revisions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  changeOrderId: varchar("change_order_id").notNull().references(() => changeOrders.id, { onDelete: "cascade" }),
  revisionNumber: integer("revision_number").notNull(),
  previousStatus: text("previous_status").notNull(),
  newStatus: text("new_status").notNull(),
  amount: decimal("amount", { precision: 12, scale: 2 }),
  description: text("description"),
  changedFields: text("changed_fields"),
  revisedById: varchar("revised_by_id").references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  changeOrderIdIdx: index("change_order_revisions_co_id_idx").on(table.changeOrderId),
}));

// Change Order Approvals - multi-level approval chain
export const changeOrderApprovals = pgTable("change_order_approvals", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  changeOrderId: varchar("change_order_id").notNull().references(() => changeOrders.id, { onDelete: "cascade" }),
  approverRole: text("approver_role").notNull(),
  approverId: varchar("approver_id").references(() => users.id),
  status: text("status").notNull().default("PENDING"),
  stepOrder: integer("step_order").notNull(),
  comments: text("comments"),
  decidedAt: timestamp("decided_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  changeOrderIdIdx: index("change_order_approvals_co_id_idx").on(table.changeOrderId),
  statusIdx: index("change_order_approvals_status_idx").on(table.status),
}));

// Change Order Attachments - normalized file attachment table (replaces attachmentsJson blob)
export const changeOrderAttachments = pgTable("change_order_attachments", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  changeOrderId: varchar("change_order_id").notNull().references(() => changeOrders.id, { onDelete: "cascade" }),
  organizationId: varchar("organization_id").notNull(),
  fileName: text("file_name").notNull(),
  fileSize: integer("file_size"),
  mimeType: text("mime_type"),
  storageKey: text("storage_key").notNull(),
  uploadedById: varchar("uploaded_by_id").notNull().references(() => users.id),
  uploadedByName: text("uploaded_by_name"),
  description: text("description"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  changeOrderIdIdx: index("co_attachments_co_id_idx").on(table.changeOrderId),
  orgIdIdx: index("co_attachments_org_id_idx").on(table.organizationId),
}));

export const insertChangeOrderAttachmentSchema = createInsertSchema(changeOrderAttachments).omit({ id: true, createdAt: true });
export type InsertChangeOrderAttachment = z.infer<typeof insertChangeOrderAttachmentSchema>;
export type ChangeOrderAttachment = typeof changeOrderAttachments.$inferSelect;

export const changeOrderComments = pgTable("change_order_comments", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  changeOrderId: varchar("change_order_id").notNull().references(() => changeOrders.id, { onDelete: "cascade" }),
  authorName: text("author_name").notNull(),
  authorEmail: text("author_email"),
  authorType: text("author_type").notNull().default("INTERNAL"),
  message: text("message").notNull(),
  isInternal: boolean("is_internal").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  changeOrderIdIdx: index("co_comments_co_id_idx").on(table.changeOrderId),
}));

export const insertChangeOrderCommentSchema = createInsertSchema(changeOrderComments).omit({ id: true, createdAt: true });
export type InsertChangeOrderComment = z.infer<typeof insertChangeOrderCommentSchema>;
export type ChangeOrderComment = typeof changeOrderComments.$inferSelect;

// Project Delays table - tracks schedule delays with change order integration
export const projectDelays = pgTable("project_delays", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  delayNumber: text("delay_number").notNull(), // e.g., DLY-260009-001
  reason: delayReasonEnum("reason").notNull(),
  reasonNotes: text("reason_notes"), // Free-form description of delay cause
  startDateTime: timestamp("start_date_time").notNull(),
  endDateTime: timestamp("end_date_time"), // Null if delay is ongoing
  estimatedDuration: integer("estimated_duration"), // Days if end unknown
  ownerRepContactId: varchar("owner_rep_contact_id"), // CRM contact who issued delay
  gcRepContactId: varchar("gc_rep_contact_id"), // GC rep who issued/acknowledged
  ownerRepName: text("owner_rep_name"), // Cached name for display
  gcRepName: text("gc_rep_name"), // Cached name for display
  proofFileId: varchar("proof_file_id"), // Reference to uploaded email/document
  proofFileName: text("proof_file_name"),
  proofFileUrl: text("proof_file_url"),
  financiallyResponsible: delayResponsibilityEnum("financially_responsible").notNull(),
  changeOrderRequired: boolean("change_order_required").notNull().default(false),
  linkedChangeOrderId: varchar("linked_change_order_id").references(() => changeOrders.id, { onDelete: "set null" }),
  proceedToWorkDate: timestamp("proceed_to_work_date"), // When work can resume
  proceedToWorkNotes: text("proceed_to_work_notes"),
  proceedToWorkFileUrl: text("proceed_to_work_file_url"), // Proof of proceed notice
  status: delayStatusEnum("status").notNull().default("DRAFT"),
  createdById: varchar("created_by_id").notNull().references(() => users.id),
  submittedAt: timestamp("submitted_at"),
  acknowledgedById: varchar("acknowledged_by_id").references(() => users.id),
  acknowledgedAt: timestamp("acknowledged_at"),
  resolvedAt: timestamp("resolved_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  // Weather evidence for WEATHER type delays
  weatherEvidenceJson: json("weather_evidence_json").$type<{
    fetchedAt: string;
    location: { lat: number; lng: number };
    dailyData: Array<{
      date: string;
      tempHigh: number;
      tempLow: number;
      precipitation: number;
      windSpeed: number;
      conditions: string;
      alerts?: string[];
    }>;
  }>(),
  locationLat: decimal("location_lat", { precision: 10, scale: 6 }),
  locationLng: decimal("location_lng", { precision: 10, scale: 6 }),
}, (table) => ({
  projectIdIdx: index("project_delays_project_id_idx").on(table.projectId),
  statusIdx: index("project_delays_status_idx").on(table.status),
  reasonIdx: index("project_delays_reason_idx").on(table.reason),
  startDateIdx: index("project_delays_start_date_idx").on(table.startDateTime),
}));

// Delay Notifications table - for generating professional notification letters/emails
export const delayNotifications = pgTable("delay_notifications", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  delayId: varchar("delay_id").notNull().references(() => projectDelays.id, { onDelete: "cascade" }),
  recipientType: delayNotificationRecipientTypeEnum("recipient_type").notNull(),
  recipientName: text("recipient_name").notNull(),
  recipientCompany: text("recipient_company"),
  recipientEmail: text("recipient_email"),
  subject: text("subject").notNull(),
  body: text("body").notNull(), // The full letter content
  status: delayNotificationStatusEnum("status").notNull().default("DRAFT"),
  createdById: varchar("created_by_id").notNull().references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  delayIdIdx: index("delay_notifications_delay_id_idx").on(table.delayId),
}));

// Project Inspections table - tracks scheduled inspections with city officials, GC reps, owner reps
export const projectInspections = pgTable("project_inspections", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  inspectionNumber: text("inspection_number").notNull(), // e.g., INSP-260009-001
  inspectionType: inspectionTypeEnum("inspection_type").notNull(),
  title: text("title").notNull(), // e.g., "Footing Inspection", "Rough Electrical"
  description: text("description"),
  requestMethod: inspectionRequestMethodEnum("request_method"),
  requestedDate: timestamp("requested_date").notNull(), // When inspection was requested
  scheduledDate: timestamp("scheduled_date"), // When inspection is scheduled
  completedDate: timestamp("completed_date"),
  status: inspectionStatusEnum("status").notNull().default("REQUESTED"),
  
  // Inspector Contact Information (from CRM or manual entry)
  inspectorContactId: varchar("inspector_contact_id"), // CRM contact ID if from CRM
  inspectorName: text("inspector_name"),
  inspectorCompany: text("inspector_company"),
  inspectorPhone: text("inspector_phone"),
  inspectorEmail: text("inspector_email"),
  
  // GC Representative (from CRM or manual entry)
  gcRepContactId: varchar("gc_rep_contact_id"), // CRM contact ID
  gcRepName: text("gc_rep_name"),
  gcRepCompany: text("gc_rep_company"),
  gcRepPhone: text("gc_rep_phone"),
  gcRepEmail: text("gc_rep_email"),
  
  // Owner Representative (from CRM or manual entry)
  ownerRepContactId: varchar("owner_rep_contact_id"), // CRM contact ID
  ownerRepName: text("owner_rep_name"),
  ownerRepCompany: text("owner_rep_company"),
  ownerRepPhone: text("owner_rep_phone"),
  ownerRepEmail: text("owner_rep_email"),
  
  // Result information
  resultNotes: text("result_notes"),
  punchListItems: text("punch_list_items"), // Items to fix if failed
  reinspectionRequired: boolean("reinspection_required").notNull().default(false),
  reinspectionDate: timestamp("reinspection_date"),
  
  // PDF and email tracking
  requestPdfUrl: text("request_pdf_url"), // Generated PDF of inspection request
  emailSentAt: timestamp("email_sent_at"),
  emailRecipients: text("email_recipients"), // Comma-separated list of emails
  
  // Metadata
  createdById: varchar("created_by_id").notNull().references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  projectIdIdx: index("project_inspections_project_id_idx").on(table.projectId),
  statusIdx: index("project_inspections_status_idx").on(table.status),
  typeIdx: index("project_inspections_type_idx").on(table.inspectionType),
  scheduledDateIdx: index("project_inspections_scheduled_date_idx").on(table.scheduledDate),
}));

export const insertProjectInspectionSchema = createInsertSchema(projectInspections).omit({ 
  id: true, 
  createdAt: true, 
  updatedAt: true 
});
export type InsertProjectInspection = z.infer<typeof insertProjectInspectionSchema>;
export type ProjectInspection = typeof projectInspections.$inferSelect;

// Punch List Items table - tracks deficiency items during project walkthrough / closeout
export const punchListItems = pgTable("punch_list_items", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  itemNumber: text("item_number").notNull(), // e.g. PLI-PROJ001-001
  title: text("title").notNull(),
  description: text("description"),
  location: text("location"), // area/room/floor/elevation
  trade: punchListTradeEnum("trade").notNull().default("GENERAL"),
  priority: punchListPriorityEnum("priority").notNull().default("MEDIUM"),
  status: punchListStatusEnum("status").notNull().default("OPEN"),

  // Assignment (user from org or manual entry)
  assignedToUserId: varchar("assigned_to_user_id").references(() => users.id, { onDelete: "set null" }),
  assignedToName: text("assigned_to_name"),
  assignedToEmail: text("assigned_to_email"),

  dueDate: timestamp("due_date"),

  // Photo / file attachments stored as JSON array [{url, filename, mimeType, uploadedAt}]
  attachments: json("attachments").$type<Array<{ url: string; filename: string; mimeType: string; uploadedAt: string }>>().default([]),

  // Status history for audit trail [{status, changedBy, changedAt, note}]
  statusHistory: json("status_history").$type<Array<{ status: string; changedBy: string; changedAt: string; note?: string }>>().default([]),

  // Optional link to a failed inspection that generated this item
  inspectionId: varchar("inspection_id").references(() => projectInspections.id, { onDelete: "set null" }),

  // Resolution timestamps
  resolvedAt: timestamp("resolved_at"),
  verifiedAt: timestamp("verified_at"),
  verifiedById: varchar("verified_by_id").references(() => users.id, { onDelete: "set null" }),

  // Metadata
  createdById: varchar("created_by_id").notNull().references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  projectIdIdx: index("punch_list_items_project_id_idx").on(table.projectId),
  statusIdx: index("punch_list_items_status_idx").on(table.status),
  priorityIdx: index("punch_list_items_priority_idx").on(table.priority),
  tradeIdx: index("punch_list_items_trade_idx").on(table.trade),
  assignedToIdx: index("punch_list_items_assigned_to_idx").on(table.assignedToUserId),
}));

export const insertPunchListItemSchema = createInsertSchema(punchListItems).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertPunchListItem = z.infer<typeof insertPunchListItemSchema>;
export type PunchListItem = typeof punchListItems.$inferSelect;

// Calendar Events table
export const calendarEvents = pgTable("calendar_events", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  eventType: calendarEventTypeEnum("event_type").notNull(),
  title: text("title").notNull(),
  description: text("description"),
  startDate: timestamp("start_date").notNull(),
  endDate: timestamp("end_date"),
  allDay: boolean("all_day").notNull().default(false),
  userId: varchar("user_id").references(() => users.id),
  projectId: varchar("project_id").references(() => projects.id),
  crmOrganisationId: varchar("crm_organisation_id").references(() => crmOrganisations.id, { onDelete: "set null" }),
  approvedById: varchar("approved_by_id").references(() => users.id),
  approvedAt: timestamp("approved_at"),
  createdById: varchar("created_by_id").notNull().references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  eventTypeIdx: index("calendar_events_event_type_idx").on(table.eventType),
  userIdIdx: index("calendar_events_user_id_idx").on(table.userId),
  crmOrgIdx: index("calendar_events_crm_org_idx").on(table.crmOrganisationId),
}));

// Notifications table
export const notifications = pgTable("notifications", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id),
  organizationId: varchar("organization_id").references(() => organizations.id),
  type: notificationTypeEnum("type").notNull(),
  title: text("title").notNull(),
  message: text("message").notNull(),
  isRead: boolean("is_read").notNull().default(false),
  relatedEntityId: varchar("related_entity_id"),
  relatedEntityType: text("related_entity_type"),
  // Task #1974 — opaque per-notification metadata. Currently used by the
  // INTEGRATION_SYNC_RETRIES_EXHAUSTED fan-out to carry a friendly
  // {recordLink, recordLabel} pair the in-app bell row renders as a
  // secondary "Open <label>" link, mirroring the email's secondary CTA
  // (Task #1945). Resolved at notification-creation time so orphan IDs
  // (record was deleted) leave the fields unset and the UI omits the
  // link, same as the email path.
  metadata: jsonb("metadata").$type<{
    recordLink?: string;
    recordLabel?: string;
  } | null>(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  userIdIdx: index("notifications_user_id_idx").on(table.userId),
  userReadIdx: index("notifications_user_read_idx").on(table.userId, table.isRead),
  createdAtIdx: index("notifications_created_at_idx").on(table.createdAt),
  orgUserReadIdx: index("notifications_org_user_read_idx").on(table.organizationId, table.userId, table.isRead),
}));

// Task #722: Persistent buffer for the rapid-fire CRM contact reassignment
// coalescer in `server/services/notificationService.ts`. Persisting these rows
// in Postgres (instead of an in-memory map) ensures the bundled "extras"
// summary email is still sent if the server restarts inside the 5-minute
// coalescing window, and lets multiple instances safely share state — only
// one instance can claim and flush a given row via `DELETE ... RETURNING`.
export const pendingContactReassignmentNotifications = pgTable("pending_contact_reassignment_notifications", {
  recipientUserId: varchar("recipient_user_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
  organizationId: varchar("organization_id").references(() => organizations.id, { onDelete: "cascade" }),
  additionalCount: integer("additional_count").notNull().default(0),
  reassignerNames: text("reassigner_names").array().notNull().default(sql`ARRAY[]::text[]`),
  firstAdditionalContactId: varchar("first_additional_contact_id"),
  windowStartedAt: timestamp("window_started_at").notNull().defaultNow(),
  flushAt: timestamp("flush_at").notNull(),
}, (table) => ({
  flushAtIdx: index("pending_contact_reassignment_flush_at_idx").on(table.flushAt),
}));

// Payroll Notifications table - tracks when time entries are ready for payroll processing
export const payrollNotifications = pgTable("payroll_notifications", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  periodStart: date("period_start").notNull(),
  periodEnd: date("period_end").notNull(),
  projectId: varchar("project_id").references(() => projects.id, { onDelete: "set null" }),
  approvingManagerId: varchar("approving_manager_id").notNull().references(() => users.id),
  officeManagerId: varchar("office_manager_id").references(() => users.id),
  status: text("status").notNull().default("PENDING"),
  totalShiftsApproved: integer("total_shifts_approved").notNull().default(0),
  totalTimeEntriesApproved: integer("total_time_entries_approved").notNull().default(0),
  totalHours: decimal("total_hours", { precision: 10, scale: 2 }),
  sentToOfficeManagerAt: timestamp("sent_to_office_manager_at"),
  processedAt: timestamp("processed_at"),
  processedById: varchar("processed_by_id").references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  orgIdx: index("payroll_notifications_org_idx").on(table.organizationId),
  periodIdx: index("payroll_notifications_period_idx").on(table.periodStart, table.periodEnd),
  statusIdx: index("payroll_notifications_status_idx").on(table.status),
}));

// File Permissions table
export const filePermissions = pgTable("file_permissions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  fileId: varchar("file_id").notNull(),
  fileType: fileTypeEnum("file_type").notNull(),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  grantedById: varchar("granted_by_id").notNull().references(() => users.id),
  grantedAt: timestamp("granted_at").notNull().defaultNow(),
});

// Job Metric Samples table — Task #705
// Persists the rolling job metrics window so trend data survives server
// restarts/deploys. Each row is a single tick's counter snapshot for one
// background job. The in-process metrics module hydrates from these rows
// at startup and prunes anything older than the retention window.
export const jobMetricSamples = pgTable("job_metric_samples", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  job: text("job").notNull(),
  recordedAt: timestamp("recorded_at").notNull().defaultNow(),
  counters: jsonb("counters").notNull(),
}, (table) => ({
  jobRecordedAtIdx: index("job_metric_samples_job_recorded_at_idx").on(table.job, table.recordedAt),
  recordedAtIdx: index("job_metric_samples_recorded_at_idx").on(table.recordedAt),
}));

// Job Metric Alert Rules table — Task #718
// Configurable alert thresholds per job/counter. Two kinds:
//   - "spike": fires when a counter's last-hour total exceeds a multiple
//     of its rolling baseline (avg of prior hourly buckets) and an
//     absolute floor.
//   - "stall": fires when a job has not produced a sample in N hours
//     (counter is empty for stall rules — applies job-wide).
// When no rule exists for a job/counter the engine falls back to sane
// defaults so admins get coverage out of the box.
export const jobMetricAlertRules = pgTable("job_metric_alert_rules", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  job: text("job").notNull(),
  counter: text("counter"),
  kind: text("kind").notNull(),
  threshold: decimal("threshold", { precision: 12, scale: 4 }).notNull(),
  minAbsolute: integer("min_absolute").notNull().default(0),
  dedupeMinutes: integer("dedupe_minutes").notNull().default(60),
  enabled: boolean("enabled").notNull().default(true),
  emailWhenAbove: decimal("email_when_above", { precision: 12, scale: 4 }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  jobKindIdx: index("job_metric_alert_rules_job_kind_idx").on(table.job, table.kind),
}));

// Job Metric Alert Events table — Task #718
// Append-only history of fired alerts. The engine reads from this table
// to dedupe (no repeat alert for the same job+counter+kind within the
// rule's dedupe window) and the admin dashboard reads from it to show
// the current alert state.
export const jobMetricAlertEvents = pgTable("job_metric_alert_events", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  job: text("job").notNull(),
  counter: text("counter"),
  kind: text("kind").notNull(),
  ruleId: varchar("rule_id"),
  message: text("message").notNull(),
  observedValue: decimal("observed_value", { precision: 18, scale: 4 }),
  baselineValue: decimal("baseline_value", { precision: 18, scale: 4 }),
  triggeredAt: timestamp("triggered_at").notNull().defaultNow(),
  notifiedUserCount: integer("notified_user_count").notNull().default(0),
  // Task #729 — acknowledge and snooze
  acknowledgedAt: timestamp("acknowledged_at"),
  acknowledgedById: varchar("acknowledged_by_id"),
  snoozedUntil: timestamp("snoozed_until"),
  snoozedById: varchar("snoozed_by_id"),
  // Task #739 — track email escalation outcome per event so the
  // dashboard can show at a glance which fired alerts also paged
  // Super Admins via email (vs. in-app notification only).
  emailed: boolean("emailed").notNull().default(false),
  emailedRecipientCount: integer("emailed_recipient_count").notNull().default(0),
  // Task #744 — distinguish "email never attempted" (didn't meet escalation
  // threshold or no opted-in recipients) from "email attempted but SendGrid
  // delivery failed". `emailAttempted` is true whenever we called the email
  // service, even if it returned false or threw; `emailError` captures the
  // failure reason so Super Admins can investigate from the dashboard.
  emailAttempted: boolean("email_attempted").notNull().default(false),
  emailError: text("email_error"),
}, (table) => ({
  jobTriggeredIdx: index("job_metric_alert_events_job_triggered_idx").on(table.job, table.triggeredAt),
  triggeredIdx: index("job_metric_alert_events_triggered_idx").on(table.triggeredAt),
  snoozedUntilIdx: index("job_metric_alert_events_snoozed_until_idx").on(table.snoozedUntil),
}));

// Job Metric Alert Quiet-Hours Digest Sends — Task #760
// Records each digest email sent to a Super Admin so the admin
// dashboard can show recent sends per recipient (sent-at, alert
// count, time range covered) and link back to the underlying
// alert events for verification. `isTest` distinguishes admin-
// triggered test sends from the regular cron-driven digests.
export const jobMetricAlertQuietHoursDigestSends = pgTable("job_metric_alert_quiet_hours_digest_sends", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  recipientEmail: text("recipient_email").notNull(),
  sentAt: timestamp("sent_at").notNull().defaultNow(),
  alertCount: integer("alert_count").notNull().default(0),
  windowStart: timestamp("window_start"),
  windowEnd: timestamp("window_end"),
  subject: text("subject").notNull(),
  isTest: boolean("is_test").notNull().default(false),
}, (table) => ({
  userSentIdx: index("job_metric_alert_quiet_hours_digest_sends_user_sent_idx").on(table.userId, table.sentAt),
  sentIdx: index("job_metric_alert_quiet_hours_digest_sends_sent_idx").on(table.sentAt),
}));

export const insertJobMetricAlertRuleSchema = createInsertSchema(jobMetricAlertRules).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertJobMetricAlertRule = z.infer<typeof insertJobMetricAlertRuleSchema>;
export type JobMetricAlertRule = typeof jobMetricAlertRules.$inferSelect;
export type JobMetricAlertEvent = typeof jobMetricAlertEvents.$inferSelect;
export type JobMetricAlertQuietHoursDigestSend = typeof jobMetricAlertQuietHoursDigestSends.$inferSelect;

// Audit Log table
export const auditLog = pgTable("audit_log", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id),
  entityType: text("entity_type").notNull(),
  entityId: varchar("entity_id").notNull(),
  action: auditActionEnum("action").notNull(),
  oldValue: text("old_value"),
  newValue: text("new_value"),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  entityTypeIdx: index("audit_log_entity_type_idx").on(table.entityType),
  entityIdIdx: index("audit_log_entity_id_idx").on(table.entityId),
  userIdIdx: index("audit_log_user_id_idx").on(table.userId),
  createdAtIdx: index("audit_log_created_at_idx").on(table.createdAt),
}));

// Task #1528 — structured history of admin one-shot job re-runs.
// Replaces the previous practice of stuffing status / duration /
// ledgerCleared / error into the free-form `audit_log.new_value`
// string and parsing it back out. The audit_log row is still written
// (for the generic compliance trail) but the admin one-shot panel
// reads from this table so the UI never has to regex-parse a log
// message and we can filter / sort on these fields server-side.
export const oneShotJobRuns = pgTable("one_shot_job_runs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  jobName: text("job_name").notNull(),
  runByUserId: varchar("run_by_user_id").references(() => users.id, { onDelete: "set null" }),
  status: text("status").notNull(),
  ledgerCleared: boolean("ledger_cleared").notNull(),
  durationMs: integer("duration_ms").notNull(),
  errorText: text("error_text"),
  // Task #1871 — structured payload for one-shot runs that produce
  // counts or other stats worth surfacing in the admin "One-shot
  // jobs" history (e.g. the restore-style audit backfill records
  // how many audit_log rows it promoted to action='RESTORE'). Kept
  // as JSONB so future runners can store arbitrary stats without a
  // schema change. Nullable so legacy rows + runners that produce
  // no extra detail keep working unchanged.
  details: jsonb("details"),
  startedAt: timestamp("started_at").notNull(),
  finishedAt: timestamp("finished_at").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  jobNameStartedAtIdx: index("one_shot_job_runs_job_started_idx").on(table.jobName, table.startedAt),
  startedAtIdx: index("one_shot_job_runs_started_at_idx").on(table.startedAt),
}));

// Billing Events table
export const billingEvents = pgTable("billing_events", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  scopeItemId: varchar("scope_item_id").notNull().references(() => scopeItems.id, { onDelete: "cascade" }),
  quantity: decimal("quantity", { precision: 12, scale: 2 }).notNull(),
  unitPrice: decimal("unit_price", { precision: 10, scale: 2 }).notNull(),
  totalAmount: decimal("total_amount", { precision: 12, scale: 2 }).notNull(),
  description: text("description"),
  createdById: varchar("created_by_id").notNull().references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// Time Clock Shifts table
export const timeClockShifts = pgTable("time_clock_shifts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id),
  projectId: varchar("project_id").references(() => projects.id, { onDelete: "set null" }),
  clockIn: timestamp("clock_in").notNull(),
  clockOut: timestamp("clock_out"),
  clockInLatitude: doublePrecision("clock_in_latitude"),
  clockInLongitude: doublePrecision("clock_in_longitude"),
  clockInAccuracy: doublePrecision("clock_in_accuracy"),
  clockOutLatitude: doublePrecision("clock_out_latitude"),
  clockOutLongitude: doublePrecision("clock_out_longitude"),
  clockOutAccuracy: doublePrecision("clock_out_accuracy"),
  costCode: text("cost_code"),
  notes: text("notes"),
  autoClockOut: boolean("auto_clock_out").notNull().default(false),
  geofenceStatus: varchar("geofence_status", { length: 20 }),
  clockOutGeofenceStatus: varchar("clock_out_geofence_status", { length: 20 }),
  spoofingFlag: boolean("spoofing_flag").default(false),
  spoofingDetails: text("spoofing_details"),
  geofenceOverride: boolean("geofence_override").default(false),
  geofenceOverrideReason: text("geofence_override_reason"),
  approvalStatus: shiftApprovalStatusEnum("approval_status").notNull().default("PENDING"),
  approvedById: varchar("approved_by_id").references(() => users.id),
  approvedAt: timestamp("approved_at"),
  totalHours: decimal("total_hours", { precision: 6, scale: 2 }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  userIdIdx: index("time_clock_shifts_user_id_idx").on(table.userId),
  clockInIdx: index("time_clock_shifts_clock_in_idx").on(table.clockIn),
  approvalStatusIdx: index("time_clock_shifts_approval_status_idx").on(table.approvalStatus),
}));

// Time Clock Events table
export const timeClockEvents = pgTable("time_clock_events", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  shiftId: varchar("shift_id").notNull().references(() => timeClockShifts.id, { onDelete: "cascade" }),
  eventType: clockEventTypeEnum("event_type").notNull(),
  timestamp: timestamp("timestamp").notNull(),
  latitude: doublePrecision("latitude"),
  longitude: doublePrecision("longitude"),
  accuracy: doublePrecision("accuracy"),
  geofenceStatus: varchar("geofence_status", { length: 20 }),
  spoofingFlag: boolean("spoofing_flag").default(false),
  notes: text("notes"),
  performedById: varchar("performed_by_id").notNull().references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const siteLeaves = pgTable("site_leaves", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  shiftId: varchar("shift_id").notNull().references(() => timeClockShifts.id, { onDelete: "cascade" }),
  userId: varchar("user_id").notNull().references(() => users.id),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  reason: text("reason").notNull(),
  category: varchar("category", { length: 30 }).notNull().default("OTHER"),
  estimatedReturnMinutes: integer("estimated_return_minutes"),
  departedAt: timestamp("departed_at").notNull().defaultNow(),
  returnedAt: timestamp("returned_at"),
  returnNotes: text("return_notes"),
  departLatitude: doublePrecision("depart_latitude"),
  departLongitude: doublePrecision("depart_longitude"),
  returnLatitude: doublePrecision("return_latitude"),
  returnLongitude: doublePrecision("return_longitude"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  shiftIdx: index("site_leaves_shift_idx").on(table.shiftId),
  userIdx: index("site_leaves_user_idx").on(table.userId),
  projectIdx: index("site_leaves_project_idx").on(table.projectId),
}));

export const insertSiteLeaveSchema = createInsertSchema(siteLeaves).omit({
  id: true,
  createdAt: true,
});

export type SiteLeave = typeof siteLeaves.$inferSelect;
export type InsertSiteLeave = z.infer<typeof insertSiteLeaveSchema>;

// Overtime Request Status enum
export const overtimeRequests = pgTable("overtime_requests", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  shiftId: varchar("shift_id").notNull().references(() => timeClockShifts.id, { onDelete: "cascade" }),
  userId: varchar("user_id").notNull().references(() => users.id),
  organizationId: varchar("organization_id").notNull(),
  requestedHours: decimal("requested_hours", { precision: 6, scale: 2 }).notNull(),
  approvedHours: decimal("approved_hours", { precision: 6, scale: 2 }),
  superintendentId: varchar("superintendent_id").notNull().references(() => users.id),
  status: overtimeRequestStatusEnum("status").notNull().default("PENDING"),
  notes: text("notes"),
  rejectionReason: text("rejection_reason"),
  approvedAt: timestamp("approved_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  userIdx: index("overtime_requests_user_idx").on(table.userId),
  shiftIdx: index("overtime_requests_shift_idx").on(table.shiftId),
  statusIdx: index("overtime_requests_status_idx").on(table.status),
  orgIdx: index("overtime_requests_org_idx").on(table.organizationId),
}));

// AI Settings table
export const estimateLineItems = pgTable("estimate_line_items", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  estimateId: varchar("estimate_id").notNull().references(() => estimates.id, { onDelete: "cascade" }),
  category: estimateItemCategoryEnum("category").notNull(),
  description: text("description").notNull(),
  quantity: decimal("quantity", { precision: 12, scale: 2 }).notNull(),
  unit: text("unit").notNull(),
  source: estimateLineItemSourceEnum("source").notNull().default("MANUAL"),
  sourceTakeoffCategoryId: varchar("source_takeoff_category_id").references(() => quantityCategories.id, { onDelete: "set null" }),
  scopeWorkTypeId: varchar("scope_work_type_id").references(() => scopeWorkTypes.id, { onDelete: "set null" }),
  workTypeCode: text("work_type_code"),
  computedQuantity: decimal("computed_quantity", { precision: 12, scale: 2 }),
  materialCost: decimal("material_cost", { precision: 12, scale: 2 }).notNull().default('0'),
  laborHours: decimal("labor_hours", { precision: 10, scale: 2 }).notNull().default('0'),
  laborCost: decimal("labor_cost", { precision: 12, scale: 2 }).notNull().default('0'),
  equipmentHours: decimal("equipment_hours", { precision: 10, scale: 2 }).notNull().default('0'),
  equipmentCost: decimal("equipment_cost", { precision: 12, scale: 2 }).notNull().default('0'),
  consumablesCost: decimal("consumables_cost", { precision: 12, scale: 2 }).notNull().default('0'),
  subcontractCost: decimal("subcontract_cost", { precision: 12, scale: 2 }).notNull().default('0'),
  subcontractorQuoteId: varchar("subcontractor_quote_id").references(() => bidSubcontractorQuotes.id, { onDelete: "set null" }),
  overheadAllocation: decimal("overhead_allocation", { precision: 12, scale: 2 }).notNull().default('0'),
  profitAllocation: decimal("profit_allocation", { precision: 12, scale: 2 }).notNull().default('0'),
  totalCost: decimal("total_cost", { precision: 12, scale: 2 }).notNull(),
  userAdjusted: boolean("user_adjusted").notNull().default(false),
  notes: text("notes"),
  metadata: text("metadata"),
  // Task #2404 — Send-to-Estimate soft-delete. Replace mode marks
  // stale rows here instead of hard-deleting so undo / audit /
  // accidental-resend protection still works.
  deletedAt: timestamp("deleted_at"),
  
  // Material Calculator Fields - Concrete
  concreteDepthInches: decimal("concrete_depth_inches", { precision: 6, scale: 2 }),
  dimensionWidthInches: decimal("dimension_width_inches", { precision: 8, scale: 2 }),
  dimensionHeightInches: decimal("dimension_height_inches", { precision: 8, scale: 2 }),
  concreteWasteFactor: decimal("concrete_waste_factor", { precision: 5, scale: 2 }).default('10'),
  calculatedConcreteYards: decimal("calculated_concrete_yards", { precision: 10, scale: 2 }),
  
  // Material Calculator Fields - Stone Sub-Base
  requiresStoneBase: boolean("requires_stone_base").default(false),
  stoneType: stoneTypeEnum("stone_type"),
  stoneDepthInches: decimal("stone_depth_inches", { precision: 6, scale: 2 }),
  stoneWasteFactor: decimal("stone_waste_factor", { precision: 5, scale: 2 }).default('10'),
  calculatedStoneTons: decimal("calculated_stone_tons", { precision: 10, scale: 2 }),
  
  // Material Calculator Fields - Excavation
  requiresExcavation: boolean("requires_excavation").default(false),
  excavationDepthInches: decimal("excavation_depth_inches", { precision: 6, scale: 2 }),
  excavationWidthInches: decimal("excavation_width_inches", { precision: 8, scale: 2 }),
  excavationSwellFactor: decimal("excavation_swell_factor", { precision: 5, scale: 2 }).default('25'),
  calculatedExcavationYards: decimal("calculated_excavation_yards", { precision: 10, scale: 2 }),
  
  // Material Calculator Fields - Wire Mesh Reinforcement
  requiresWireMesh: boolean("requires_wire_mesh").default(false),
  wireMeshType: wireMeshTypeEnum("wire_mesh_type"),
  wireMeshCoverageSF: decimal("wire_mesh_coverage_sf", { precision: 8, scale: 2 }).default('150'),
  wireMeshWasteFactor: decimal("wire_mesh_waste_factor", { precision: 5, scale: 2 }).default('10'),
  calculatedWireMeshRolls: decimal("calculated_wire_mesh_rolls", { precision: 10, scale: 2 }),
  
  // Material Calculator Fields - Rebar Reinforcement
  requiresRebar: boolean("requires_rebar").default(false),
  rebarSize: rebarSizeEnum("rebar_size"),
  rebarSpacingInches: decimal("rebar_spacing_inches", { precision: 6, scale: 2 }).default('12'),
  rebarLengthFeet: decimal("rebar_length_feet", { precision: 6, scale: 2 }).default('20'),
  rebarWasteFactor: decimal("rebar_waste_factor", { precision: 5, scale: 2 }).default('10'),
  calculatedRebarCount: decimal("calculated_rebar_count", { precision: 10, scale: 0 }),
  calculatedRebarLinearFeet: decimal("calculated_rebar_linear_feet", { precision: 12, scale: 2 }),
  
  // Material Calculator Fields - Dowels (for joints)
  requiresDowels: boolean("requires_dowels").default(false),
  dowelSize: dowelSizeEnum("dowel_size"),
  dowelSpacingInches: decimal("dowel_spacing_inches", { precision: 6, scale: 2 }).default('12'),
  dowelLengthInches: decimal("dowel_length_inches", { precision: 6, scale: 2 }).default('18'),
  jointLengthFeet: decimal("joint_length_feet", { precision: 10, scale: 2 }),
  calculatedDowelCount: decimal("calculated_dowel_count", { precision: 10, scale: 0 }),
  
  // Material Calculator Fields - Sealer
  requiresSealer: boolean("requires_sealer").default(false),
  sealerType: sealerTypeEnum("sealer_type"),
  sealerCoverageSFPerGallon: decimal("sealer_coverage_sf_per_gallon", { precision: 8, scale: 2 }).default('200'),
  sealerCoats: integer("sealer_coats").default(1),
  sealerWasteFactor: decimal("sealer_waste_factor", { precision: 5, scale: 2 }).default('10'),
  calculatedSealerGallons: decimal("calculated_sealer_gallons", { precision: 10, scale: 2 }),
  
  // Material Calculator Fields - Plastic Underlayment / Vapor Barrier
  requiresUnderlayment: boolean("requires_underlayment").default(false),
  underlaymentType: underlaymentTypeEnum("underlayment_type"),
  underlaymentOverlapInches: decimal("underlayment_overlap_inches", { precision: 6, scale: 2 }).default('6'),
  underlaymentWasteFactor: decimal("underlayment_waste_factor", { precision: 5, scale: 2 }).default('10'),
  calculatedUnderlaymentSF: decimal("calculated_underlayment_sf", { precision: 12, scale: 2 }),
  
  // Aggregated material requirements JSON for procurement export
  materialRequirementsJson: text("material_requirements_json"),
  equipmentRequirementsJson: text("equipment_requirements_json"),
  
  // Labor Rate Tracking - links to organization's job classifications
  jobClassificationId: varchar("job_classification_id").references(() => jobClassifications.id, { onDelete: "set null" }),
  laborRateUsed: decimal("labor_rate_used", { precision: 10, scale: 2 }), // Stores the rate at time of creation for historical accuracy
  
  // Unified SOW Tracking - links to organization's master SOW library for production rate tracking
  organizationSowItemId: varchar("organization_sow_item_id").references(() => organizationSowItems.id, { onDelete: "set null" }),
  
  vendorPricingId: varchar("vendor_pricing_id"),
  vendorMatchConfidence: text("vendor_match_confidence"),

  // DOT pay item linking — heavy civil bid integration
  dotPayItemId: varchar("dot_pay_item_id").references(() => dotPayItems.id, { onDelete: "set null" }),
  dotSpecBookId: varchar("dot_spec_book_id").references(() => dotSpecBooks.id, { onDelete: "set null" }),
  payItemNumber: varchar("pay_item_number", { length: 64 }),
  specSection: varchar("spec_section", { length: 32 }),

  
  photoUrl: text("photo_url"),
  photoUrls: text("photo_urls").array().notNull().default(sql`ARRAY[]::text[]`),

  // Task #2404 — Send-to-Estimate provenance. When a line item was
  // pushed in from a takeoff, `sourceType` is "takeoff_send", with
  // `sourceTakeoffId` keyed to the takeoff (standalone or otherwise)
  // and `sourceMeasurementId` to the specific measurement that
  // produced this line. The pair (estimateId, sourceMeasurementId)
  // serves as the idempotency key for re-send.
  sourceType: text("source_type"),
  sourceTakeoffId: varchar("source_takeoff_id"),
  sourceMeasurementId: varchar("source_measurement_id"),

  // Task #2578 — Phase C: line type discriminator
  // BASE | ALTERNATE | ALLOWANCE | CONTINGENCY (validated via Zod;
  // see estimateLineTypeSchema in shared/schema/features/estimate_pricing.ts).
  lineType: text("line_type").notNull().default("BASE"),
  // FK enforced at the DB level (see migration 0102) — kept as plain varchar
  // here to avoid a circular import on the alternate-groups table.
  alternateGroupId: varchar("alternate_group_id"),
  // 'FIXED' | 'PERCENT_OF_BASE' (only meaningful when lineType='ALLOWANCE')
  allowanceBasis: text("allowance_basis"),
  // Only meaningful when lineType='CONTINGENCY'
  contingencyPercent: decimal("contingency_percent", { precision: 5, scale: 2 }),

  // Cost-book provenance (visible source / code / as-of on lines)
  costBookEntryId: varchar("cost_book_entry_id"),
  costBookSource: text("cost_book_source"),
  costBookSourceCode: text("cost_book_source_code"),
  costBookAsOfDate: date("cost_book_as_of_date"),
  costBookGeoFactor: decimal("cost_book_geo_factor", { precision: 6, scale: 3 }),

  // Crew composition / equipment-day pricing
  crewTemplateId: varchar("crew_template_id"),
  crewDays: decimal("crew_days", { precision: 8, scale: 2 }),

  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  estimateIdx: index("estimate_line_items_estimate_idx").on(table.estimateId),
  categoryIdx: index("estimate_line_items_category_idx").on(table.category),
  sourceIdx: index("estimate_line_items_source_idx").on(table.source),
  takeoffSendIdx: index("estimate_line_items_source_measurement_idx").on(table.estimateId, table.sourceMeasurementId),
  scopeWorkTypeIdx: index("estimate_line_items_scope_work_type_idx").on(table.scopeWorkTypeId),
  workTypeCodeIdx: index("estimate_line_items_work_type_code_idx").on(table.workTypeCode),
  subcontractorQuoteIdx: index("estimate_line_items_subcontractor_quote_idx").on(table.subcontractorQuoteId),
  jobClassificationIdx: index("estimate_line_items_job_classification_idx").on(table.jobClassificationId),
  organizationSowItemIdx: index("estimate_line_items_org_sow_item_idx").on(table.organizationSowItemId),
  lineTypeIdx: index("estimate_line_items_line_type_idx").on(table.lineType),
}));

export const estimateLineItemSubcontractors = pgTable("estimate_line_item_subcontractors", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  lineItemId: varchar("line_item_id").notNull().references(() => estimateLineItems.id, { onDelete: "cascade" }),
  subcontractorQuoteId: varchar("subcontractor_quote_id").notNull().references(() => bidSubcontractorQuotes.id, { onDelete: "cascade" }),
  allocatedCost: decimal("allocated_cost", { precision: 12, scale: 2 }).notNull().default('0'),
  isSelected: boolean("is_selected").notNull().default(true),
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  lineItemIdx: index("eli_sub_line_item_idx").on(table.lineItemId),
  quoteIdx: index("eli_sub_quote_idx").on(table.subcontractorQuoteId),
  uniqueAssignment: unique("eli_sub_unique_assignment").on(table.lineItemId, table.subcontractorQuoteId),
}));

// Estimate Versions table (snapshots of estimates)
export const passwordResetTokens = pgTable("password_reset_tokens", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  usedAt: timestamp("used_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  userIdx: index("password_reset_tokens_user_idx").on(table.userId),
  expiresIdx: index("password_reset_tokens_expires_idx").on(table.expiresAt),
}));

export const insertPasswordResetTokenSchema = createInsertSchema(passwordResetTokens).omit({
  id: true,
  usedAt: true,
  createdAt: true,
});
export type InsertPasswordResetToken = z.infer<typeof insertPasswordResetTokenSchema>;
export type PasswordResetToken = typeof passwordResetTokens.$inferSelect;

export const emailVerificationTokens = pgTable("email_verification_tokens", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  usedAt: timestamp("used_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  userIdx: index("email_verification_tokens_user_idx").on(table.userId),
  expiresIdx: index("email_verification_tokens_expires_idx").on(table.expiresAt),
}));

export type EmailVerificationToken = typeof emailVerificationTokens.$inferSelect;

export const insertBidSubcontractorQuoteSchema = createInsertSchema(bidSubcontractorQuotes).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
}).extend({
  fileUrl: z.string().optional(),
  fileName: z.string().optional(),
  fileSize: z.number().optional(),
  mimeType: z.string().optional(),
});

export const insertBidMaterialQuoteSchema = createInsertSchema(bidMaterialQuotes).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
}).extend({
  fileUrl: z.string().optional(),
  fileName: z.string().optional(),
  fileSize: z.number().optional(),
  mimeType: z.string().optional(),
});

export const insertEstimateSchema = createInsertSchema(estimates).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertProcurementItemSchema = createInsertSchema(procurementItems).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertPlanDocumentSchema = createInsertSchema(planDocuments).omit({
  id: true,
  uploadedAt: true,
});

// Plan Pins (Task #576) — pins for RFI / Punch / Submittal anchored to plan sheets
export const planPinPinTypeEnum = pgEnum("plan_pin_pin_type", ["RFI", "PUNCH", "SUBMITTAL"]);

export const planPins = pgTable("plan_pins", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  projectCode: text("project_code").notNull(),
  planDocumentId: varchar("plan_document_id").notNull().references(() => planDocuments.id, { onDelete: "cascade" }),
  pageNumber: integer("page_number").notNull().default(1),
  x: doublePrecision("x").notNull(),
  y: doublePrecision("y").notNull(),
  pinType: planPinPinTypeEnum("pin_type").notNull(),
  refTable: text("ref_table").notNull(),
  refId: varchar("ref_id").notNull(),
  createdById: varchar("created_by_id").notNull().references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  // Task #1609: carryover-from-revision tracking. When a pin is copied
  // forward to a new plan_document revision via the carryover endpoint
  // we record the source pin id so re-running the carryover is idempotent
  // (UNIQUE on (plan_document_id, source_pin_id)).
  sourcePinId: varchar("source_pin_id"),
}, (table) => ({
  docPageIdx: index("plan_pins_doc_page_idx").on(table.planDocumentId, table.pageNumber),
  projectCodeIdx: index("plan_pins_project_code_idx").on(table.projectCode),
  orgIdx: index("plan_pins_org_idx").on(table.organizationId),
  uniqueDocSource: unique("plan_pins_doc_source_unique").on(table.planDocumentId, table.sourcePinId),
}));

export const insertPlanPinSchema = createInsertSchema(planPins).omit({
  id: true,
  createdAt: true,
});
export type InsertPlanPin = z.infer<typeof insertPlanPinSchema>;
export type PlanPin = typeof planPins.$inferSelect;

// Task #1662: User-defined markup layers (parity with takeoff layer
// metadata). Each plan_document gets one auto-created `Default` layer
// and zero or more user-named layers (e.g. "QA/QC", "Design Review").
// Markups reference a layer via `plan_document_markups.layer_id`; a
// null layer_id means "default layer" so the original behaviour for
// pre-#1662 rows is preserved without a backfill.
export const planMarkupLayers = pgTable("plan_markup_layers", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  planDocumentId: varchar("plan_document_id").notNull().references(() => planDocuments.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  // Optional swatch shown in the layers panel; not applied to markups
  // (markups carry their own color).
  color: text("color").notNull().default("#94a3b8"),
  sortOrder: integer("sort_order").notNull().default(0),
  // Auto-created default layer per plan_document. Cannot be deleted
  // and cannot be renamed away from "Default".
  isDefault: boolean("is_default").notNull().default(false),
  createdById: varchar("created_by_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  docIdx: index("plan_markup_layers_doc_idx").on(table.planDocumentId),
  orgIdx: index("plan_markup_layers_org_idx").on(table.organizationId),
  uniqueName: unique("plan_markup_layers_doc_name_unique").on(table.planDocumentId, table.name),
}));

export const insertPlanMarkupLayerSchema = createInsertSchema(planMarkupLayers).omit({
  id: true,
  createdAt: true,
});
export type InsertPlanMarkupLayer = z.infer<typeof insertPlanMarkupLayerSchema>;
export type PlanMarkupLayer = typeof planMarkupLayers.$inferSelect;

// Per-user, per-layer visibility toggle. Absence of a row means
// "visible" (the default), so toggling a layer hidden writes a row
// with is_visible=false. Scoped to (user, layer) so two users sharing
// a sheet can independently focus on their own layers.
export const planMarkupLayerVisibility = pgTable("plan_markup_layer_visibility", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  layerId: varchar("layer_id").notNull().references(() => planMarkupLayers.id, { onDelete: "cascade" }),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  isVisible: boolean("is_visible").notNull().default(true),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  uniqueUserLayer: unique("plan_markup_layer_visibility_user_layer_unique").on(table.userId, table.layerId),
  layerIdx: index("plan_markup_layer_visibility_layer_idx").on(table.layerId),
}));

export type PlanMarkupLayerVisibility = typeof planMarkupLayerVisibility.$inferSelect;

// Task #1609: Plan-document-scoped markups. Mirrors `takeoff_markups`
// shape but is keyed to (plan_document_id, page_number) so the
// project-side PlansTab gets independent annotation storage from the
// bid-side takeoff workspace. The shape intentionally mirrors
// `takeoff_markups.tool/points/color/thickness/text` so the React
// rendering layer can be shared.
export const planDocumentMarkups = pgTable("plan_document_markups", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  projectId: varchar("project_id").references(() => projects.id, { onDelete: "cascade" }),
  planDocumentId: varchar("plan_document_id").notNull().references(() => planDocuments.id, { onDelete: "cascade" }),
  pageNumber: integer("page_number").notNull().default(1),
  // Tool name: ARROW, TEXT, RECTANGLE, CLOUD, HIGHLIGHT, FREEHAND.
  // Stored as text (not the takeoff_markup_tool enum) so the two
  // surfaces can evolve independently in future phases.
  tool: text("tool").notNull(),
  // JSON array of {x, y} normalized 0-1 coordinates per the page.
  points: text("points").notNull(),
  color: text("color").notNull().default("#ff0000"),
  thickness: integer("thickness").notNull().default(2),
  text: text("text"),
  createdBy: varchar("created_by").notNull().references(() => users.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  // Task #1609: carryover tracking — when this markup was copied from a
  // previous revision's markup, source_markup_id records that origin so
  // a repeat carryover is idempotent.
  sourceMarkupId: varchar("source_markup_id"),
  // Task #1662: layer membership. NULL means "default layer" so legacy
  // rows continue rendering without backfill. SET NULL on delete so a
  // layer deletion drops the markup back to the default.
  layerId: varchar("layer_id").references(() => planMarkupLayers.id, { onDelete: "set null" }),
  // Task #1662: opaque grouping handle. Markups sharing a non-null
  // group_id move and delete together as one unit. Ungrouping sets
  // this to NULL on every member.
  groupId: varchar("group_id"),
  // Task #1775: soft-delete column. NULL means "live"; a non-null
  // timestamp means the row was deleted at that instant. The DELETE
  // route stamps it (rather than removing the row) so the new
  // `POST /api/plan-document-markups/:id/restore` route can clear it
  // and bring the markup back with its original id, layer, group, and
  // every other column intact. Every read path filters
  // `deleted_at IS NULL` so soft-deleted rows are invisible to LIST,
  // counts, group/ungroup, bulk-move, carryover, and copy-to-sheet.
  deletedAt: timestamp("deleted_at"),
}, (table) => ({
  docPageIdx: index("plan_document_markups_doc_page_idx").on(table.planDocumentId, table.pageNumber),
  orgIdx: index("plan_document_markups_org_idx").on(table.organizationId),
  createdByIdx: index("plan_document_markups_created_by_idx").on(table.createdBy),
  uniqueDocSource: unique("plan_document_markups_doc_source_unique").on(table.planDocumentId, table.sourceMarkupId),
  layerIdx: index("plan_document_markups_layer_idx").on(table.layerId),
  groupIdx: index("plan_document_markups_group_idx").on(table.groupId),
}));

export const insertPlanDocumentMarkupSchema = createInsertSchema(planDocumentMarkups).omit({
  id: true,
  createdAt: true,
  // Task #1775 — soft-delete column is server-managed (DELETE stamps it,
  // restore clears it); never accept it on an insert payload.
  deletedAt: true,
});
export type InsertPlanDocumentMarkup = z.infer<typeof insertPlanDocumentMarkupSchema>;
export type PlanDocumentMarkup = typeof planDocumentMarkups.$inferSelect;

export const insertTimeEntrySchema = createInsertSchema(timeEntries).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  approvedAt: true,
  rejectedAt: true,
});

export const insertProjectLaborRateSchema = createInsertSchema(projectLaborRates).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertProjectEmployeeRateSchema = createInsertSchema(projectEmployeeRates).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertJobClassificationSchema = createInsertSchema(jobClassifications).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertEmployeeClassificationSchema = createInsertSchema(employeeClassifications).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertPrevailingWageRateSchema = createInsertSchema(prevailingWageRates).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

/** @deprecated Use insertTMTicketSchema instead. See tmDailySheets deprecation note. */
export const insertTMDailySheetSchema = createInsertSchema(tmDailySheets).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertReceiptSchema = createInsertSchema(receipts).omit({
  id: true,
  createdAt: true,
});

export const insertProjectNoteSchema = createInsertSchema(projectNotes).omit({
  id: true,
  createdAt: true,
});

export const insertCompanyDailyNoteSchema = createInsertSchema(companyDailyNotes).omit({
  id: true,
  createdAt: true,
});

export const insertAINoteInsightSchema = createInsertSchema(aiNoteInsights).omit({
  id: true,
  createdAt: true,
});

export const insertScopeItemSchema = createInsertSchema(scopeItems).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertDailyScopeProgressSchema = createInsertSchema(dailyScopeProgress).omit({
  id: true,
  billedDate: true,
  billedById: true,
  createdAt: true,
  updatedAt: true,
});

export const insertMediaSchema = createInsertSchema(media).omit({
  id: true,
  uploadedAt: true,
});

export const insertFilePermissionSchema = createInsertSchema(filePermissions).omit({
  id: true,
  grantedAt: true,
});

// Type exports
export type InsertBidSubcontractorQuote = z.infer<typeof insertBidSubcontractorQuoteSchema>;
export type BidSubcontractorQuote = typeof bidSubcontractorQuotes.$inferSelect;

export type InsertBidMaterialQuote = z.infer<typeof insertBidMaterialQuoteSchema>;
export type BidMaterialQuote = typeof bidMaterialQuotes.$inferSelect;

export type InsertEstimate = z.infer<typeof insertEstimateSchema>;
export type Estimate = typeof estimates.$inferSelect;

export type InsertProcurementItem = z.infer<typeof insertProcurementItemSchema>;
export type ProcurementItem = typeof procurementItems.$inferSelect;

export type InsertPlanDocument = z.infer<typeof insertPlanDocumentSchema>;
export type PlanDocument = typeof planDocuments.$inferSelect;

export type InsertTimeEntry = z.infer<typeof insertTimeEntrySchema>;
export type TimeEntry = typeof timeEntries.$inferSelect;

export type InsertProjectLaborRate = z.infer<typeof insertProjectLaborRateSchema>;
export type ProjectLaborRate = typeof projectLaborRates.$inferSelect;

export type InsertProjectEmployeeRate = z.infer<typeof insertProjectEmployeeRateSchema>;
export type ProjectEmployeeRate = typeof projectEmployeeRates.$inferSelect;

export type InsertJobClassification = z.infer<typeof insertJobClassificationSchema>;
export type JobClassification = typeof jobClassifications.$inferSelect;

export type InsertEmployeeClassification = z.infer<typeof insertEmployeeClassificationSchema>;
export type EmployeeClassification = typeof employeeClassifications.$inferSelect;

export type InsertPrevailingWageRate = z.infer<typeof insertPrevailingWageRateSchema>;
export type PrevailingWageRate = typeof prevailingWageRates.$inferSelect;

export const insertAnnualSalaryCategorySchema = createInsertSchema(annualSalaryCategories).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertBurdenRateSchema = createInsertSchema(burdenRates).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertEmployeeCostAssignmentSchema = createInsertSchema(employeeCostAssignments).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  fullyBurdenedCost: true,
  derivedHourlyRate: true,
});

export type InsertAnnualSalaryCategory = z.infer<typeof insertAnnualSalaryCategorySchema>;
export type AnnualSalaryCategory = typeof annualSalaryCategories.$inferSelect;

export type InsertBurdenRate = z.infer<typeof insertBurdenRateSchema>;
export type BurdenRate = typeof burdenRates.$inferSelect;

export type InsertEmployeeCostAssignment = z.infer<typeof insertEmployeeCostAssignmentSchema>;
export type EmployeeCostAssignment = typeof employeeCostAssignments.$inferSelect;

/** @deprecated Use InsertTMTicket instead. See tmDailySheets deprecation note. */
export type InsertTMDailySheet = z.infer<typeof insertTMDailySheetSchema>;
/** @deprecated Use TMTicket instead. See tmDailySheets deprecation note. */
export type TMDailySheet = typeof tmDailySheets.$inferSelect;

// T&M Invoice schemas and types
export const insertTMInvoiceSchema = createInsertSchema(tmInvoices).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  sentAt: true,
  paidAt: true,
});

export type InsertTMInvoice = z.infer<typeof insertTMInvoiceSchema>;
export type TMInvoice = typeof tmInvoices.$inferSelect;

// T&M Ticket schemas and types
export const insertTMTicketSchema = createInsertSchema(tmTickets).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  submittedAt: true,
  approvedAt: true,
  rejectedAt: true,
  signedDocumentUploadedAt: true,
  billingApprovedAt: true,
  billedAt: true,
});

export const insertTMTicketLaborEntrySchema = createInsertSchema(tmTicketLaborEntries).omit({
  id: true,
  createdAt: true,
});

export const insertTMTicketEquipmentEntrySchema = createInsertSchema(tmTicketEquipmentEntries).omit({
  id: true,
  createdAt: true,
});

export const insertTMTicketMaterialEntrySchema = createInsertSchema(tmTicketMaterialEntries).omit({
  id: true,
  createdAt: true,
});

export type InsertTMTicket = z.infer<typeof insertTMTicketSchema>;
export type TMTicket = typeof tmTickets.$inferSelect;

export type InsertTMTicketLaborEntry = z.infer<typeof insertTMTicketLaborEntrySchema>;
export type TMTicketLaborEntry = typeof tmTicketLaborEntries.$inferSelect;

export type InsertTMTicketEquipmentEntry = z.infer<typeof insertTMTicketEquipmentEntrySchema>;
export type TMTicketEquipmentEntry = typeof tmTicketEquipmentEntries.$inferSelect;

export type InsertTMTicketMaterialEntry = z.infer<typeof insertTMTicketMaterialEntrySchema>;
export type TMTicketMaterialEntry = typeof tmTicketMaterialEntries.$inferSelect;

export type InsertReceipt = z.infer<typeof insertReceiptSchema>;
export type Receipt = typeof receipts.$inferSelect;

export type InsertProjectNote = z.infer<typeof insertProjectNoteSchema>;
export type ProjectNote = typeof projectNotes.$inferSelect;

export type InsertCompanyDailyNote = z.infer<typeof insertCompanyDailyNoteSchema>;
export type CompanyDailyNote = typeof companyDailyNotes.$inferSelect;

export type InsertAINoteInsight = z.infer<typeof insertAINoteInsightSchema>;
export type AINoteInsight = typeof aiNoteInsights.$inferSelect;

export type InsertScopeItem = z.infer<typeof insertScopeItemSchema>;
export type ScopeItem = typeof scopeItems.$inferSelect;

export type InsertDailyScopeProgress = z.infer<typeof insertDailyScopeProgressSchema>;
export type DailyScopeProgress = typeof dailyScopeProgress.$inferSelect;

export const insertProjectMaterialBudgetSchema = createInsertSchema(projectMaterialBudgets).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  actualQuantityUsed: true,
  actualTotalCost: true,
  varianceQuantity: true,
  variancePercent: true,
  alertTriggered: true,
  alertTriggeredAt: true,
});
export type InsertProjectMaterialBudget = z.infer<typeof insertProjectMaterialBudgetSchema>;
export type ProjectMaterialBudget = typeof projectMaterialBudgets.$inferSelect;

export const insertProjectMaterialUsageSchema = createInsertSchema(projectMaterialUsage).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertProjectMaterialUsage = z.infer<typeof insertProjectMaterialUsageSchema>;
export type ProjectMaterialUsage = typeof projectMaterialUsage.$inferSelect;

export type InsertMedia = z.infer<typeof insertMediaSchema>;
export type Media = typeof media.$inferSelect;

export const insertChangeOrderSchema = createInsertSchema(changeOrders).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  approvedAt: true,
  changeOrderNumber: true,
});

export const insertCalendarEventSchema = createInsertSchema(calendarEvents).omit({
  id: true,
  createdAt: true,
  approvedAt: true,
});

export const insertNotificationSchema = createInsertSchema(notifications).omit({
  id: true,
  createdAt: true,
});

export type InsertChangeOrder = z.infer<typeof insertChangeOrderSchema>;
export type ChangeOrder = typeof changeOrders.$inferSelect;

// Change Order Line Item schemas
export const insertChangeOrderLaborEntrySchema = createInsertSchema(changeOrderLaborEntries).omit({
  id: true,
});
export const insertChangeOrderEquipmentEntrySchema = createInsertSchema(changeOrderEquipmentEntries).omit({
  id: true,
});
export const insertChangeOrderMaterialEntrySchema = createInsertSchema(changeOrderMaterialEntries).omit({
  id: true,
});

export type InsertChangeOrderLaborEntry = z.infer<typeof insertChangeOrderLaborEntrySchema>;
export type ChangeOrderLaborEntry = typeof changeOrderLaborEntries.$inferSelect;

export type InsertChangeOrderEquipmentEntry = z.infer<typeof insertChangeOrderEquipmentEntrySchema>;
export type ChangeOrderEquipmentEntry = typeof changeOrderEquipmentEntries.$inferSelect;

export type InsertChangeOrderMaterialEntry = z.infer<typeof insertChangeOrderMaterialEntrySchema>;
export type ChangeOrderMaterialEntry = typeof changeOrderMaterialEntries.$inferSelect;

// Change Order Revisions schema
export const insertChangeOrderRevisionSchema = createInsertSchema(changeOrderRevisions).omit({
  id: true,
  createdAt: true,
});
export type InsertChangeOrderRevision = z.infer<typeof insertChangeOrderRevisionSchema>;
export type ChangeOrderRevision = typeof changeOrderRevisions.$inferSelect;

// Change Order Approvals schema
export const insertChangeOrderApprovalSchema = createInsertSchema(changeOrderApprovals).omit({
  id: true,
  createdAt: true,
});
export type InsertChangeOrderApproval = z.infer<typeof insertChangeOrderApprovalSchema>;
export type ChangeOrderApproval = typeof changeOrderApprovals.$inferSelect;

// Project Delays schema
export const insertProjectDelaySchema = createInsertSchema(projectDelays).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  submittedAt: true,
  acknowledgedAt: true,
  resolvedAt: true,
});

export type InsertProjectDelay = z.infer<typeof insertProjectDelaySchema>;
export type ProjectDelay = typeof projectDelays.$inferSelect;

export const insertDelayNotificationSchema = createInsertSchema(delayNotifications).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertDelayNotification = z.infer<typeof insertDelayNotificationSchema>;
export type DelayNotification = typeof delayNotifications.$inferSelect;

// Delay Claims table - formal claims for time extensions or cost impacts from delays
export const delayClaims = pgTable("delay_claims", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  claimNumber: text("claim_number").notNull(), // e.g., CLM-260009-001
  title: text("title").notNull(),
  description: text("description"),
  claimType: delayClaimTypeEnum("claim_type").notNull(),
  status: delayClaimStatusEnum("status").notNull().default("DRAFT"),
  
  // Linked delays - can include multiple delay records
  linkedDelayIds: text("linked_delay_ids").array(), // Array of projectDelay IDs
  
  // Time extension request
  daysRequested: integer("days_requested"),
  daysApproved: integer("days_approved"),
  originalCompletionDate: timestamp("original_completion_date"),
  requestedCompletionDate: timestamp("requested_completion_date"),
  
  // Cost impact request
  costRequested: decimal("cost_requested", { precision: 12, scale: 2 }),
  costApproved: decimal("cost_approved", { precision: 12, scale: 2 }),
  costBreakdownJson: json("cost_breakdown_json").$type<{
    laborCost?: number;
    equipmentCost?: number;
    materialCost?: number;
    overheadCost?: number;
    otherCosts?: Array<{ description: string; amount: number }>;
  }>(),
  
  // Supporting documentation
  supportingDocUrls: text("supporting_doc_urls").array(),
  weatherEvidenceSummary: text("weather_evidence_summary"),
  
  // Workflow tracking
  submittedAt: timestamp("submitted_at"),
  submittedById: varchar("submitted_by_id").references(() => users.id),
  reviewedAt: timestamp("reviewed_at"),
  reviewedById: varchar("reviewed_by_id").references(() => users.id),
  reviewNotes: text("review_notes"),
  approvedAt: timestamp("approved_at"),
  approvedById: varchar("approved_by_id").references(() => users.id),
  rejectedAt: timestamp("rejected_at"),
  rejectedById: varchar("rejected_by_id").references(() => users.id),
  rejectionReason: text("rejection_reason"),
  
  // Linked change order for approved claims
  linkedChangeOrderId: varchar("linked_change_order_id").references(() => changeOrders.id, { onDelete: "set null" }),
  
  createdById: varchar("created_by_id").notNull().references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  orgIdx: index("delay_claims_org_idx").on(table.organizationId),
  projectIdx: index("delay_claims_project_idx").on(table.projectId),
  statusIdx: index("delay_claims_status_idx").on(table.status),
  claimNumberIdx: index("delay_claims_number_idx").on(table.claimNumber),
}));

export const insertDelayClaimSchema = createInsertSchema(delayClaims).omit({
  id: true,
  claimNumber: true,
  createdAt: true,
  updatedAt: true,
  submittedAt: true,
  reviewedAt: true,
  approvedAt: true,
  rejectedAt: true,
});
export type InsertDelayClaim = z.infer<typeof insertDelayClaimSchema>;
export type DelayClaim = typeof delayClaims.$inferSelect;

// Daily Report Locks table - prevents tampering with daily reports for legal evidence
export const dailyReportLocks = pgTable("daily_report_locks", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  reportDate: date("report_date").notNull(),
  status: dailyReportLockStatusEnum("status").notNull().default("UNLOCKED"),
  
  // Lock metadata
  lockedAt: timestamp("locked_at"),
  lockedById: varchar("locked_by_id").references(() => users.id),
  lockReason: text("lock_reason"),
  
  // Supervisor override
  supervisorLockedAt: timestamp("supervisor_locked_at"),
  supervisorLockedById: varchar("supervisor_locked_by_id").references(() => users.id),
  supervisorLockNotes: text("supervisor_lock_notes"),
  
  // Hash for data integrity verification
  contentHash: text("content_hash"), // SHA-256 hash of report content at lock time
  
  // Linked claim if locked for evidence
  linkedClaimId: varchar("linked_claim_id").references(() => delayClaims.id, { onDelete: "set null" }),
  
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  orgIdx: index("daily_report_locks_org_idx").on(table.organizationId),
  projectIdx: index("daily_report_locks_project_idx").on(table.projectId),
  dateIdx: index("daily_report_locks_date_idx").on(table.reportDate),
  statusIdx: index("daily_report_locks_status_idx").on(table.status),
  projectDateUnique: unique("daily_report_locks_project_date_unique").on(table.projectId, table.reportDate),
}));

export const insertDailyReportLockSchema = createInsertSchema(dailyReportLocks).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  lockedAt: true,
  supervisorLockedAt: true,
});
export type InsertDailyReportLock = z.infer<typeof insertDailyReportLockSchema>;
export type DailyReportLock = typeof dailyReportLocks.$inferSelect;

// Photo Custody Records table - chain of custody tracking for photos used as evidence
export const photoCustodyRecords = pgTable("photo_custody_records", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  
  // Photo reference
  photoUrl: text("photo_url").notNull(),
  photoFileName: text("photo_file_name").notNull(),
  photoObjectKey: text("photo_object_key"),
  
  // Original metadata (preserved at capture time)
  originalMetadataJson: json("original_metadata_json").$type<{
    captureTimestamp: string;
    deviceId?: string;
    deviceModel?: string;
    gpsLat?: number;
    gpsLng?: number;
    gpsAccuracy?: number;
    fileHash?: string;
  }>(),
  
  // Custody action tracking
  action: photoCustodyActionEnum("action").notNull(),
  actionById: varchar("action_by_id").notNull().references(() => users.id),
  actionAt: timestamp("action_at").notNull().defaultNow(),
  actionNotes: text("action_notes"),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  
  // Linked entities
  linkedClaimId: varchar("linked_claim_id").references(() => delayClaims.id, { onDelete: "set null" }),
  linkedDelayId: varchar("linked_delay_id").references(() => projectDelays.id, { onDelete: "set null" }),
  
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  orgIdx: index("photo_custody_org_idx").on(table.organizationId),
  projectIdx: index("photo_custody_project_idx").on(table.projectId),
  photoUrlIdx: index("photo_custody_photo_url_idx").on(table.photoUrl),
  actionIdx: index("photo_custody_action_idx").on(table.action),
  claimIdx: index("photo_custody_claim_idx").on(table.linkedClaimId),
}));

export const insertPhotoCustodyRecordSchema = createInsertSchema(photoCustodyRecords).omit({
  id: true,
  createdAt: true,
  actionAt: true,
});
export type InsertPhotoCustodyRecord = z.infer<typeof insertPhotoCustodyRecordSchema>;
export type PhotoCustodyRecord = typeof photoCustodyRecords.$inferSelect;

export type InsertCalendarEvent = z.infer<typeof insertCalendarEventSchema>;
export type CalendarEvent = typeof calendarEvents.$inferSelect;

export type InsertNotification = z.infer<typeof insertNotificationSchema>;
export type Notification = typeof notifications.$inferSelect;

export const insertPayrollNotificationSchema = createInsertSchema(payrollNotifications).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  sentToOfficeManagerAt: true,
  processedAt: true,
});
export type InsertPayrollNotification = z.infer<typeof insertPayrollNotificationSchema>;
export type PayrollNotification = typeof payrollNotifications.$inferSelect;

export type InsertFilePermission = z.infer<typeof insertFilePermissionSchema>;
export type FilePermission = typeof filePermissions.$inferSelect;

export const insertAuditLogSchema = createInsertSchema(auditLog).omit({
  id: true,
  createdAt: true,
});

export const insertOneShotJobRunSchema = createInsertSchema(oneShotJobRuns).omit({
  id: true,
  createdAt: true,
});
export type InsertOneShotJobRun = z.infer<typeof insertOneShotJobRunSchema>;
export type OneShotJobRun = typeof oneShotJobRuns.$inferSelect;

export const insertBillingEventSchema = createInsertSchema(billingEvents).omit({
  id: true,
  createdAt: true,
});

export const insertTimeClockShiftSchema = createInsertSchema(timeClockShifts).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  approvedAt: true,
});

export const insertTimeClockEventSchema = createInsertSchema(timeClockEvents).omit({
  id: true,
  createdAt: true,
});

export type InsertAuditLog = z.infer<typeof insertAuditLogSchema>;
export type AuditLog = typeof auditLog.$inferSelect;

export type InsertBillingEvent = z.infer<typeof insertBillingEventSchema>;
export type BillingEvent = typeof billingEvents.$inferSelect;

export type InsertTimeClockShift = z.infer<typeof insertTimeClockShiftSchema>;
export type TimeClockShift = typeof timeClockShifts.$inferSelect;

export type InsertTimeClockEvent = z.infer<typeof insertTimeClockEventSchema>;

export const insertOvertimeRequestSchema = createInsertSchema(overtimeRequests).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  approvedAt: true,
  approvedHours: true,
  rejectionReason: true,
  status: true,
});
export type InsertOvertimeRequest = z.infer<typeof insertOvertimeRequestSchema>;
export type OvertimeRequest = typeof overtimeRequests.$inferSelect;
export type TimeClockEvent = typeof timeClockEvents.$inferSelect;

const coerceDecimalString = z.union([z.string(), z.number()]).transform((val) => String(val));
const coerceDecimalStringNullable = z.union([z.string(), z.number(), z.null()]).transform((val) => val === null ? null : String(val));

export const insertEstimateLineItemSchema = createInsertSchema(estimateLineItems).omit({ id: true, createdAt: true, updatedAt: true }).extend({
  quantity: coerceDecimalString,
  materialCost: coerceDecimalString,
  laborHours: coerceDecimalString,
  laborCost: coerceDecimalString,
  equipmentHours: coerceDecimalString,
  equipmentCost: coerceDecimalString,
  consumablesCost: coerceDecimalString,
  subcontractCost: coerceDecimalString,
  overheadAllocation: coerceDecimalString,
  profitAllocation: coerceDecimalString,
  totalCost: coerceDecimalString,
  computedQuantity: coerceDecimalStringNullable.optional(),
  laborRateUsed: coerceDecimalStringNullable.optional(),
  concreteDepthInches: coerceDecimalStringNullable.optional(),
  dimensionWidthInches: coerceDecimalStringNullable.optional(),
  dimensionHeightInches: coerceDecimalStringNullable.optional(),
  concreteWasteFactor: coerceDecimalStringNullable.optional(),
  calculatedConcreteYards: coerceDecimalStringNullable.optional(),
  stoneDepthInches: coerceDecimalStringNullable.optional(),
  stoneWasteFactor: coerceDecimalStringNullable.optional(),
  calculatedStoneTons: coerceDecimalStringNullable.optional(),
  excavationDepthInches: coerceDecimalStringNullable.optional(),
  excavationWidthInches: coerceDecimalStringNullable.optional(),
  excavationSwellFactor: coerceDecimalStringNullable.optional(),
  calculatedExcavationYards: coerceDecimalStringNullable.optional(),
  wireMeshCoverageSF: coerceDecimalStringNullable.optional(),
  wireMeshWasteFactor: coerceDecimalStringNullable.optional(),
  calculatedWireMeshRolls: coerceDecimalStringNullable.optional(),
  rebarSpacingInches: coerceDecimalStringNullable.optional(),
  rebarLengthFeet: coerceDecimalStringNullable.optional(),
  rebarWasteFactor: coerceDecimalStringNullable.optional(),
  calculatedRebarCount: coerceDecimalStringNullable.optional(),
  calculatedRebarLinearFeet: coerceDecimalStringNullable.optional(),
  dowelSpacingInches: coerceDecimalStringNullable.optional(),
  dowelLengthInches: coerceDecimalStringNullable.optional(),
  jointLengthFeet: coerceDecimalStringNullable.optional(),
  calculatedDowelCount: coerceDecimalStringNullable.optional(),
  sealerCoverageSFPerGallon: coerceDecimalStringNullable.optional(),
  sealerWasteFactor: coerceDecimalStringNullable.optional(),
  calculatedSealerGallons: coerceDecimalStringNullable.optional(),
  underlaymentOverlapInches: coerceDecimalStringNullable.optional(),
  underlaymentWasteFactor: coerceDecimalStringNullable.optional(),
  calculatedUnderlaymentSF: coerceDecimalStringNullable.optional(),
});
export type InsertEstimateLineItem = z.infer<typeof insertEstimateLineItemSchema>;
export const updateEstimateLineItemSchema = insertEstimateLineItemSchema.partial();
export type UpdateEstimateLineItem = z.infer<typeof updateEstimateLineItemSchema>;
export type EstimateLineItem = typeof estimateLineItems.$inferSelect;

export const insertEstimateLineItemSubcontractorSchema = createInsertSchema(estimateLineItemSubcontractors).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertEstimateLineItemSubcontractor = z.infer<typeof insertEstimateLineItemSubcontractorSchema>;
export type EstimateLineItemSubcontractor = typeof estimateLineItemSubcontractors.$inferSelect;

export const purchaseRequests = pgTable("purchase_requests", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  orgId: varchar("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  requestedById: varchar("requested_by_id").notNull().references(() => users.id),
  prNumber: text("pr_number").notNull(),
  title: text("title").notNull(),
  status: purchaseRequestStatusEnum("status").notNull().default("DRAFT"),
  neededByDate: timestamp("needed_by_date"),
  notes: text("notes"),
  totalEstimatedCost: decimal("total_estimated_cost", { precision: 12, scale: 2 }),
  rejectionNotes: text("rejection_notes"),
  approvedById: varchar("approved_by_id").references(() => users.id),
  approvedAt: timestamp("approved_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => [
  index("purchase_requests_org_id_idx").on(table.orgId),
  unique("purchase_requests_pr_number_unique").on(table.prNumber),
]);

export const purchaseRequestItems = pgTable("purchase_request_items", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  prId: varchar("pr_id").notNull().references(() => purchaseRequests.id, { onDelete: "cascade" }),
  description: text("description").notNull(),
  category: text("category"),
  quantity: decimal("quantity", { precision: 10, scale: 2 }),
  unit: text("unit"),
  estimatedUnitCost: decimal("estimated_unit_cost", { precision: 10, scale: 2 }),
  costCode: text("cost_code"),
});

export const purchaseOrders = pgTable("purchase_orders", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  orgId: varchar("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  prId: varchar("pr_id").references(() => purchaseRequests.id),
  vendorId: varchar("vendor_id").references(() => crmOrganisations.id),
  poNumber: text("po_number").notNull(),
  status: purchaseOrderStatusEnum("status").notNull().default("DRAFT"),
  terms: text("terms"),
  deliveryAddress: text("delivery_address"),
  neededByDate: timestamp("needed_by_date"),
  notes: text("notes"),
  totalCost: decimal("total_cost", { precision: 12, scale: 2 }),
  rejectionNotes: text("rejection_notes"),
  approvedById: varchar("approved_by_id").references(() => users.id),
  approvedAt: timestamp("approved_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => [
  index("purchase_orders_org_id_idx").on(table.orgId),
  unique("purchase_orders_po_number_unique").on(table.poNumber),
]);

export const purchaseOrderItems = pgTable("purchase_order_items", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  poId: varchar("po_id").notNull().references(() => purchaseOrders.id, { onDelete: "cascade" }),
  prItemId: varchar("pr_item_id").references(() => purchaseRequestItems.id),
  description: text("description").notNull(),
  quantity: decimal("quantity", { precision: 10, scale: 2 }),
  unit: text("unit"),
  unitCost: decimal("unit_cost", { precision: 10, scale: 2 }),
  quantityReceived: decimal("quantity_received", { precision: 10, scale: 2 }).default("0"),
  costCode: text("cost_code"),
  expectedDeliveryDate: timestamp("expected_delivery_date"),
});

export const poReceipts = pgTable("po_receipts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  poId: varchar("po_id").notNull().references(() => purchaseOrders.id, { onDelete: "cascade" }),
  receivedById: varchar("received_by_id").notNull().references(() => users.id),
  receivedAt: timestamp("received_at").notNull().defaultNow(),
  deliveryNote: text("delivery_note"),
  status: poReceiptStatusEnum("status").notNull().default("PARTIAL"),
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const poReceiptItems = pgTable("po_receipt_items", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  receiptId: varchar("receipt_id").notNull().references(() => poReceipts.id, { onDelete: "cascade" }),
  poItemId: varchar("po_item_id").notNull().references(() => purchaseOrderItems.id),
  quantityReceived: decimal("quantity_received", { precision: 10, scale: 2 }).notNull(),
  condition: poReceiptItemConditionEnum("condition").notNull().default("GOOD"),
  notes: text("notes"),
});

export const vendorInvoices = pgTable("vendor_invoices", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  orgId: varchar("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  poId: varchar("po_id").notNull().references(() => purchaseOrders.id, { onDelete: "cascade" }),
  vendorId: varchar("vendor_id").references(() => crmOrganisations.id),
  invoiceNumber: text("invoice_number").notNull(),
  invoiceDate: timestamp("invoice_date").notNull(),
  dueDate: timestamp("due_date"),
  totalAmount: decimal("total_amount", { precision: 12, scale: 2 }).notNull(),
  status: vendorInvoiceStatusEnum("status").notNull().default("PENDING"),
  notes: text("notes"),
  fileUrl: text("file_url"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => [
  index("vendor_invoices_org_id_idx").on(table.orgId),
]);

export const invoiceMatches = pgTable("invoice_matches", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  invoiceId: varchar("invoice_id").notNull().references(() => vendorInvoices.id, { onDelete: "cascade" }),
  poId: varchar("po_id").notNull().references(() => purchaseOrders.id),
  receiptId: varchar("receipt_id").references(() => poReceipts.id),
  matchStatus: invoiceMatchStatusEnum("match_status").notNull().default("PENDING"),
  poAmount: decimal("po_amount", { precision: 12, scale: 2 }),
  invoiceAmount: decimal("invoice_amount", { precision: 12, scale: 2 }),
  receivedQtyMatchPct: decimal("received_qty_match_pct", { precision: 5, scale: 2 }),
  discrepancyNotes: text("discrepancy_notes"),
  resolvedById: varchar("resolved_by_id").references(() => users.id),
  resolvedAt: timestamp("resolved_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertPurchaseRequestSchema = createInsertSchema(purchaseRequests).omit({ id: true, createdAt: true, updatedAt: true, approvedAt: true });
export type InsertPurchaseRequest = z.infer<typeof insertPurchaseRequestSchema>;
export type PurchaseRequest = typeof purchaseRequests.$inferSelect;

export const insertPurchaseRequestItemSchema = createInsertSchema(purchaseRequestItems).omit({ id: true });
export type InsertPurchaseRequestItem = z.infer<typeof insertPurchaseRequestItemSchema>;
export type PurchaseRequestItem = typeof purchaseRequestItems.$inferSelect;

export const insertPurchaseOrderSchema = createInsertSchema(purchaseOrders).omit({ id: true, createdAt: true, updatedAt: true, approvedAt: true });
export type InsertPurchaseOrder = z.infer<typeof insertPurchaseOrderSchema>;
export type PurchaseOrder = typeof purchaseOrders.$inferSelect;

export const insertPurchaseOrderItemSchema = createInsertSchema(purchaseOrderItems).omit({ id: true });
export type InsertPurchaseOrderItem = z.infer<typeof insertPurchaseOrderItemSchema>;
export type PurchaseOrderItem = typeof purchaseOrderItems.$inferSelect;

export const insertPoReceiptSchema = createInsertSchema(poReceipts).omit({ id: true, createdAt: true });
export type InsertPoReceipt = z.infer<typeof insertPoReceiptSchema>;
export type PoReceipt = typeof poReceipts.$inferSelect;

export const insertPoReceiptItemSchema = createInsertSchema(poReceiptItems).omit({ id: true });
export type InsertPoReceiptItem = z.infer<typeof insertPoReceiptItemSchema>;
export type PoReceiptItem = typeof poReceiptItems.$inferSelect;

export const vendorInvoiceItems = pgTable("vendor_invoice_items", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  invoiceId: varchar("invoice_id").notNull().references(() => vendorInvoices.id, { onDelete: "cascade" }),
  poItemId: varchar("po_item_id").references(() => purchaseOrderItems.id),
  description: text("description").notNull(),
  quantity: decimal("quantity", { precision: 12, scale: 2 }),
  unitCost: decimal("unit_cost", { precision: 12, scale: 2 }),
  amount: decimal("amount", { precision: 12, scale: 2 }).notNull(),
});

export const insertVendorInvoiceSchema = createInsertSchema(vendorInvoices).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertVendorInvoice = z.infer<typeof insertVendorInvoiceSchema>;
export type VendorInvoice = typeof vendorInvoices.$inferSelect;

export const insertVendorInvoiceItemSchema = createInsertSchema(vendorInvoiceItems).omit({ id: true });
export type InsertVendorInvoiceItem = z.infer<typeof insertVendorInvoiceItemSchema>;
export type VendorInvoiceItem = typeof vendorInvoiceItems.$inferSelect;

export const insertInvoiceMatchSchema = createInsertSchema(invoiceMatches).omit({ id: true, createdAt: true });
export type InsertInvoiceMatch = z.infer<typeof insertInvoiceMatchSchema>;
export type InvoiceMatch = typeof invoiceMatches.$inferSelect;

export const invoicePayments = pgTable("invoice_payments", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  orgId: varchar("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  invoiceId: varchar("invoice_id").notNull().references(() => vendorInvoices.id, { onDelete: "cascade" }),
  amount: decimal("amount", { precision: 12, scale: 2 }).notNull(),
  paymentDate: timestamp("payment_date").notNull(),
  method: text("method"),
  referenceNumber: text("reference_number"),
  notes: text("notes"),
  recordedById: varchar("recorded_by_id").notNull().references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  index("invoice_payments_org_id_idx").on(table.orgId),
  index("invoice_payments_invoice_id_idx").on(table.invoiceId),
]);

export const insertInvoicePaymentSchema = createInsertSchema(invoicePayments).omit({ id: true, createdAt: true });
export type InsertInvoicePayment = z.infer<typeof insertInvoicePaymentSchema>;
export type InvoicePayment = typeof invoicePayments.$inferSelect;

export const orgCostCodes = pgTable("org_cost_codes", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  organizationId: varchar("organization_id").notNull(),
  code: varchar("code", { length: 20 }).notNull(),
  description: varchar("description", { length: 255 }).notNull(),
  division: varchar("division", { length: 100 }).notNull(),
  isCustom: boolean("is_custom").notNull().default(true),
  isActive: boolean("is_active").notNull().default(true),
  deactivatedById: varchar("deactivated_by_id").references(() => users.id),
  deactivatedAt: timestamp("deactivated_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  index("org_cost_codes_org_idx").on(table.organizationId),
  unique("org_cost_codes_org_code_uniq").on(table.organizationId, table.code),
]);

export const insertOrgCostCodeSchema = createInsertSchema(orgCostCodes).omit({ createdAt: true, updatedAt: true });
export type InsertOrgCostCode = z.infer<typeof insertOrgCostCodeSchema>;
export type OrgCostCode = typeof orgCostCodes.$inferSelect;

export const projectCostCodes = pgTable("project_cost_codes", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  costCode: varchar("cost_code", { length: 20 }).notNull(),
  isActive: boolean("is_active").notNull().default(true),
  assignedAt: timestamp("assigned_at").defaultNow().notNull(),
}, (table) => [
  index("project_cost_codes_project_idx").on(table.projectId),
  unique("project_cost_codes_project_code_uniq").on(table.projectId, table.costCode),
]);

export const insertProjectCostCodeSchema = createInsertSchema(projectCostCodes).omit({ assignedAt: true });
export type InsertProjectCostCode = z.infer<typeof insertProjectCostCodeSchema>;
export type ProjectCostCode = typeof projectCostCodes.$inferSelect;

export const budgetLineItems = pgTable("budget_line_items", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  costCode: varchar("cost_code", { length: 20 }).notNull(),
  description: varchar("description", { length: 255 }).notNull(),
  division: varchar("division", { length: 100 }).notNull(),
  laborBudget: decimal("labor_budget", { precision: 12, scale: 2 }).notNull().default("0"),
  materialBudget: decimal("material_budget", { precision: 12, scale: 2 }).notNull().default("0"),
  subcontractorBudget: decimal("subcontractor_budget", { precision: 12, scale: 2 }).notNull().default("0"),
  equipmentBudget: decimal("equipment_budget", { precision: 12, scale: 2 }).notNull().default("0"),
  otherBudget: decimal("other_budget", { precision: 12, scale: 2 }).notNull().default("0"),
  totalBudget: decimal("total_budget", { precision: 12, scale: 2 }).notNull().default("0"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  index("budget_line_items_project_idx").on(table.projectId),
  unique("budget_line_items_project_code_uniq").on(table.projectId, table.costCode),
]);

export const insertBudgetLineItemSchema = createInsertSchema(budgetLineItems).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertBudgetLineItem = z.infer<typeof insertBudgetLineItemSchema>;
export type BudgetLineItem = typeof budgetLineItems.$inferSelect;

export const forecastAdjustments = pgTable("forecast_adjustments", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  costCode: varchar("cost_code", { length: 20 }).notNull(),
  adjustedETC: decimal("adjusted_etc", { precision: 12, scale: 2 }).notNull(),
  note: text("note"),
  updatedBy: varchar("updated_by").notNull().references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => [
  index("forecast_adjustments_project_idx").on(table.projectId),
  unique("forecast_adjustments_project_code_uniq").on(table.projectId, table.costCode),
]);

export const insertForecastAdjustmentSchema = createInsertSchema(forecastAdjustments).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertForecastAdjustment = z.infer<typeof insertForecastAdjustmentSchema>;
export type ForecastAdjustment = typeof forecastAdjustments.$inferSelect;

export const budgetAlerts = pgTable("budget_alerts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  costCode: varchar("cost_code", { length: 20 }),
  alertLevel: text("alert_level").notNull(),
  thresholdPercent: decimal("threshold_percent", { precision: 5, scale: 2 }).notNull(),
  currentPercent: decimal("current_percent", { precision: 5, scale: 2 }).notNull(),
  budgetAmount: decimal("budget_amount", { precision: 12, scale: 2 }).notNull(),
  actualAmount: decimal("actual_amount", { precision: 12, scale: 2 }).notNull(),
  isDismissed: boolean("is_dismissed").notNull().default(false),
  dismissedBy: varchar("dismissed_by").references(() => users.id),
  dismissedAt: timestamp("dismissed_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  index("budget_alerts_project_idx").on(table.projectId),
  index("budget_alerts_dismissed_idx").on(table.isDismissed),
]);

export const insertBudgetAlertSchema = createInsertSchema(budgetAlerts).omit({ id: true, createdAt: true });
export type InsertBudgetAlert = z.infer<typeof insertBudgetAlertSchema>;
export type BudgetAlert = typeof budgetAlerts.$inferSelect;

export const domainEvents = pgTable("domain_events", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  type: text("type").notNull(),
  version: integer("version").notNull().default(1),
  orgId: varchar("org_id").notNull(),
  actorId: varchar("actor_id").notNull(),
  payload: json("payload").notNull(),
  status: domainEventStatusEnum("status").notNull().default("PENDING"),
  processedAt: timestamp("processed_at"),
  failureReason: text("failure_reason"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  index("domain_events_status_idx").on(table.status),
  index("domain_events_type_idx").on(table.type),
  index("domain_events_created_at_idx").on(table.createdAt),
]);

export const insertDomainEventSchema = createInsertSchema(domainEvents).omit({
  id: true,
  processedAt: true,
  failureReason: true,
  createdAt: true,
});
export type InsertDomainEvent = z.infer<typeof insertDomainEventSchema>;
export type DomainEventRecord = typeof domainEvents.$inferSelect;

export const pushSubscriptions = pgTable("push_subscriptions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  endpoint: text("endpoint").notNull(),
  p256dh: text("p256dh").notNull(),
  auth: text("auth").notNull(),
  userAgent: text("user_agent"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  userEndpointUnique: unique().on(table.userId, table.endpoint),
}));

export const insertPushSubscriptionSchema = createInsertSchema(pushSubscriptions).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertPushSubscription = z.infer<typeof insertPushSubscriptionSchema>;
export type PushSubscription = typeof pushSubscriptions.$inferSelect;

export const notificationChannelPrefs = pgTable("notification_channel_prefs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }).unique(),
  emailEnabled: boolean("email_enabled").notNull().default(false),
  smsEnabled: boolean("sms_enabled").notNull().default(false),
  pushEnabled: boolean("push_enabled").notNull().default(false),
  teamsEnabled: boolean("teams_enabled").notNull().default(false),
  slackEnabled: boolean("slack_enabled").notNull().default(false),
  smsPhoneNumber: text("sms_phone_number"),
  teamsWebhookUrl: text("teams_webhook_url"),
  slackWebhookUrl: text("slack_webhook_url"),
  birthdayReminderCadence: birthdayReminderCadenceEnum("birthday_reminder_cadence").notNull().default("DAILY_LOOKAHEAD"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertNotificationChannelPrefsSchema = createInsertSchema(notificationChannelPrefs).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertNotificationChannelPrefs = z.infer<typeof insertNotificationChannelPrefsSchema>;
export type NotificationChannelPrefs = typeof notificationChannelPrefs.$inferSelect;

export const notificationTypePrefs = pgTable("notification_type_prefs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  notificationType: notificationTypeEnum("notification_type").notNull(),
  emailEnabled: boolean("email_enabled").notNull().default(false),
  smsEnabled: boolean("sms_enabled").notNull().default(false),
  pushEnabled: boolean("push_enabled").notNull().default(false),
  teamsEnabled: boolean("teams_enabled").notNull().default(false),
  slackEnabled: boolean("slack_enabled").notNull().default(false),
  // Task #1260 — Per-type opt-out for the in-app notification feed.
  // Nullable so legacy rows continue to behave as "in-app on" (the
  // historical default). When `false`, the notifications row is still
  // inserted so outbound channels (email/push/SMS/Teams/Slack) can be
  // delivered independently per their own per-type prefs; the in-app
  // feed and unread-count endpoints filter the row out at read time.
  inAppEnabled: boolean("in_app_enabled"),
  // Task #1747 — Optional snooze expiry for per-type mutes. When set,
  // the row's email/in-app overrides are treated as if the row didn't
  // exist once `mutedUntil <= now` (i.e. the mute auto-clears and
  // delivery falls back to channel defaults). NULL means "indefinite"
  // — the historical behavior — so existing rows don't change semantics.
  // Only the digest-dashboard mute card writes a non-NULL value today
  // (it surfaces snooze affordances "mute for 7 days" etc.); the
  // standard notification preferences page clears this column on every
  // update so an explicit choice from the standard settings UI always
  // wins over a stale snooze.
  mutedUntil: timestamp("muted_until"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  userTypeUnique: unique().on(table.userId, table.notificationType),
}));

export const insertNotificationTypePrefsSchema = createInsertSchema(notificationTypePrefs).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertNotificationTypePrefs = z.infer<typeof insertNotificationTypePrefsSchema>;
export type NotificationTypePrefs = typeof notificationTypePrefs.$inferSelect;

export const uploadIntents = pgTable("upload_intents", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  uploadedById: varchar("uploaded_by_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  objectKey: text("object_key").notNull(),
  contentType: text("content_type").notNull(),
  fileSize: integer("file_size").notNull(),
  resumableUri: text("resumable_uri"),
  chunkSize: integer("chunk_size"),
  confirmedAt: timestamp("confirmed_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  organizationIdIdx: index("upload_intents_organization_id_idx").on(table.organizationId),
  createdAtIdx: index("upload_intents_created_at_idx").on(table.createdAt),
}));

export const insertUploadIntentSchema = createInsertSchema(uploadIntents).omit({
  id: true,
  confirmedAt: true,
  createdAt: true,
});
export type InsertUploadIntent = z.infer<typeof insertUploadIntentSchema>;
export type UploadIntent = typeof uploadIntents.$inferSelect;

// ─── WARRANTY MODULE ──────────────────────────────────────────────────────────

export const warrantyCases = pgTable("warranty_cases", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  caseNumber: text("case_number").notNull(), // e.g. WC-PROJ001-001

  // Classification
  type: warrantyCaseTypeEnum("type").notNull().default("DEFECT"),
  status: warrantyCaseStatusEnum("status").notNull().default("OPEN"),
  priority: warrantyPriorityEnum("priority").notNull().default("MEDIUM"),

  // Case details
  title: text("title").notNull(),
  description: text("description"),
  location: text("location"),

  // Client / reporter info
  reportedByName: text("reported_by_name"),
  reportedByEmail: text("reported_by_email"),
  reportedByPhone: text("reported_by_phone"),

  // Assignment
  assignedToUserId: varchar("assigned_to_user_id").references(() => users.id, { onDelete: "set null" }),
  assignedToName: text("assigned_to_name"),

  // Dates
  reportedDate: timestamp("reported_date"),
  targetResolutionDate: timestamp("target_resolution_date"),
  resolvedAt: timestamp("resolved_at"),
  closedAt: timestamp("closed_at"),

  // Costs (optional)
  estimatedCost: decimal("estimated_cost", { precision: 12, scale: 2 }),
  actualCost: decimal("actual_cost", { precision: 12, scale: 2 }),

  // Resolution
  rootCause: text("root_cause"),
  resolution: text("resolution"),

  // Status history for audit trail [{status, changedBy, changedAt, note}]
  statusHistory: json("status_history").$type<Array<{ status: string; changedBy: string; changedAt: string; note?: string }>>().default([]),

  // Metadata
  createdById: varchar("created_by_id").notNull().references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  projectIdIdx: index("warranty_cases_project_id_idx").on(table.projectId),
  statusIdx: index("warranty_cases_status_idx").on(table.status),
  typeIdx: index("warranty_cases_type_idx").on(table.type),
  priorityIdx: index("warranty_cases_priority_idx").on(table.priority),
}));

export const insertWarrantyCaseSchema = createInsertSchema(warrantyCases).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertWarrantyCase = z.infer<typeof insertWarrantyCaseSchema>;
export type WarrantyCase = typeof warrantyCases.$inferSelect;

// ─── WARRANTY TASKS ───────────────────────────────────────────────────────────

export const warrantyTasks = pgTable("warranty_tasks", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  caseId: varchar("case_id").notNull().references(() => warrantyCases.id, { onDelete: "cascade" }),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),

  title: text("title").notNull(),
  description: text("description"),
  status: warrantyTaskStatusEnum("status").notNull().default("PENDING"),

  assignedToUserId: varchar("assigned_to_user_id").references(() => users.id, { onDelete: "set null" }),
  assignedToName: text("assigned_to_name"),

  dueDate: timestamp("due_date"),
  completedAt: timestamp("completed_at"),
  estimatedHours: decimal("estimated_hours", { precision: 5, scale: 2 }),
  actualHours: decimal("actual_hours", { precision: 5, scale: 2 }),
  notes: text("notes"),

  createdById: varchar("created_by_id").notNull().references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  caseIdIdx: index("warranty_tasks_case_id_idx").on(table.caseId),
  projectIdIdx: index("warranty_tasks_project_id_idx").on(table.projectId),
  statusIdx: index("warranty_tasks_status_idx").on(table.status),
}));

export const insertWarrantyTaskSchema = createInsertSchema(warrantyTasks).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertWarrantyTask = z.infer<typeof insertWarrantyTaskSchema>;
export type WarrantyTask = typeof warrantyTasks.$inferSelect;

// ─── WARRANTY DOCUMENTS ───────────────────────────────────────────────────────

export const warrantyDocuments = pgTable("warranty_documents", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  caseId: varchar("case_id").notNull().references(() => warrantyCases.id, { onDelete: "cascade" }),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),

  documentType: warrantyDocumentTypeEnum("document_type").notNull().default("OTHER"),
  title: text("title").notNull(),
  url: text("url").notNull(),
  filename: text("filename").notNull(),
  mimeType: text("mime_type"),
  fileSize: integer("file_size"),

  uploadedById: varchar("uploaded_by_id").notNull().references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  caseIdIdx: index("warranty_documents_case_id_idx").on(table.caseId),
  projectIdIdx: index("warranty_documents_project_id_idx").on(table.projectId),
}));

export const insertWarrantyDocumentSchema = createInsertSchema(warrantyDocuments).omit({
  id: true,
  createdAt: true,
});
export type InsertWarrantyDocument = z.infer<typeof insertWarrantyDocumentSchema>;
export type WarrantyDocument = typeof warrantyDocuments.$inferSelect;

export const leaveTypes = pgTable("leave_types", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  annualAllowance: integer("annual_allowance").notNull().default(0),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  orgIdx: index("leave_types_org_idx").on(table.organizationId),
}));

export const insertLeaveTypeSchema = createInsertSchema(leaveTypes).omit({
  id: true,
  createdAt: true,
});
export type InsertLeaveType = z.infer<typeof insertLeaveTypeSchema>;
export type LeaveType = typeof leaveTypes.$inferSelect;

export const leaveRequests = pgTable("leave_requests", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  employeeId: varchar("employee_id").notNull().references(() => users.id),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  leaveTypeId: varchar("leave_type_id").notNull().references(() => leaveTypes.id),
  startDate: date("start_date").notNull(),
  endDate: date("end_date").notNull(),
  reason: text("reason"),
  status: leaveRequestStatusEnum("status").notNull().default("PENDING"),
  reviewerId: varchar("reviewer_id").references(() => users.id),
  reviewerNote: text("reviewer_note"),
  reviewedAt: timestamp("reviewed_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  employeeIdx: index("leave_requests_employee_idx").on(table.employeeId),
  orgIdx: index("leave_requests_org_idx").on(table.organizationId),
  statusIdx: index("leave_requests_status_idx").on(table.status),
  leaveTypeIdx: index("leave_requests_leave_type_idx").on(table.leaveTypeId),
}));

export const insertLeaveRequestSchema = createInsertSchema(leaveRequests).omit({
  id: true,
  createdAt: true,
  reviewerId: true,
  reviewerNote: true,
  reviewedAt: true,
  status: true,
});
export type InsertLeaveRequest = z.infer<typeof insertLeaveRequestSchema>;
export type LeaveRequest = typeof leaveRequests.$inferSelect;

// ─── ASSET HANDOVER ───────────────────────────────────────────────────────────

export const assetHandoverItems = pgTable("asset_handover_items", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  category: text("category").notNull(),
  title: text("title").notNull(),
  description: text("description"),
  status: handoverItemStatusEnum("status").notNull().default("PENDING"),
  documentUrl: text("document_url"),
  documentFilename: text("document_filename"),
  completedAt: timestamp("completed_at"),
  completedById: varchar("completed_by_id").references(() => users.id),
  sortOrder: integer("sort_order").notNull().default(0),
  createdById: varchar("created_by_id").notNull().references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  projectIdIdx: index("handover_items_project_id_idx").on(table.projectId),
  statusIdx: index("handover_items_status_idx").on(table.status),
}));

export const insertHandoverItemSchema = createInsertSchema(assetHandoverItems).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertHandoverItem = z.infer<typeof insertHandoverItemSchema>;
export type HandoverItem = typeof assetHandoverItems.$inferSelect;

export const assetHandoverSignoffs = pgTable("asset_handover_signoffs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  role: handoverSignoffRoleEnum("role").notNull(),
  signedByUserId: varchar("signed_by_user_id").notNull().references(() => users.id),
  signedByName: text("signed_by_name").notNull(),
  signedAt: timestamp("signed_at").notNull().defaultNow(),
  notes: text("notes"),
}, (table) => ({
  projectIdIdx: index("handover_signoffs_project_id_idx").on(table.projectId),
}));

export const insertHandoverSignoffSchema = createInsertSchema(assetHandoverSignoffs).omit({
  id: true,
  signedAt: true,
});
export type InsertHandoverSignoff = z.infer<typeof insertHandoverSignoffSchema>;
export type HandoverSignoff = typeof assetHandoverSignoffs.$inferSelect;

// ─── MAINTENANCE LOGS ─────────────────────────────────────────────────────────

export const maintenanceLogs = pgTable("maintenance_logs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  date: timestamp("date").notNull(),
  type: assetMaintenanceTypeEnum("type").notNull(),
  system: maintenanceSystemEnum("system").notNull(),
  title: text("title").notNull(),
  description: text("description"),
  cost: decimal("cost", { precision: 12, scale: 2 }),
  vendorName: text("vendor_name"),
  documentUrl: text("document_url"),
  documentFilename: text("document_filename"),
  createdById: varchar("created_by_id").notNull().references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  projectIdIdx: index("maintenance_logs_project_id_idx").on(table.projectId),
  typeIdx: index("maintenance_logs_type_idx").on(table.type),
  systemIdx: index("maintenance_logs_system_idx").on(table.system),
  dateIdx: index("maintenance_logs_date_idx").on(table.date),
}));

export const insertMaintenanceLogSchema = createInsertSchema(maintenanceLogs).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertMaintenanceLog = z.infer<typeof insertMaintenanceLogSchema>;
export type MaintenanceLog = typeof maintenanceLogs.$inferSelect;

export const maintenanceRecurringSchedules = pgTable("maintenance_recurring_schedules", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  system: maintenanceSystemEnum("system").notNull(),
  frequency: recurringFrequencyEnum("frequency").notNull(),
  description: text("description"),
  nextDueDate: timestamp("next_due_date"),
  isActive: boolean("is_active").notNull().default(true),
  createdById: varchar("created_by_id").notNull().references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  projectIdIdx: index("maint_recurring_project_id_idx").on(table.projectId),
  activeIdx: index("maint_recurring_active_idx").on(table.isActive),
}));

export const insertMaintenanceRecurringScheduleSchema = createInsertSchema(maintenanceRecurringSchedules).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertMaintenanceRecurringSchedule = z.infer<typeof insertMaintenanceRecurringScheduleSchema>;
export type MaintenanceRecurringSchedule = typeof maintenanceRecurringSchedules.$inferSelect;

// ─── HISTORICAL COSTS ────────────────────────────────────────────────────────

export const historicalCosts = pgTable("historical_costs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  projectId: varchar("project_id").references(() => projects.id, { onDelete: "set null" }),
  projectName: text("project_name"),
  projectType: text("project_type"),
  costCode: text("cost_code"),
  scopeCategory: text("scope_category").notNull(),
  trade: text("trade"),
  description: text("description").notNull(),
  quantity: decimal("quantity", { precision: 12, scale: 2 }).notNull(),
  unit: text("unit").notNull(),
  unitCost: decimal("unit_cost", { precision: 12, scale: 4 }).notNull(),
  totalCost: decimal("total_cost", { precision: 14, scale: 2 }).notNull(),
  materialCost: decimal("material_cost", { precision: 12, scale: 2 }),
  laborCost: decimal("labor_cost", { precision: 12, scale: 2 }),
  equipmentCost: decimal("equipment_cost", { precision: 12, scale: 2 }),
  subcontractCost: decimal("subcontract_cost", { precision: 12, scale: 2 }),
  completedDate: date("completed_date"),
  source: text("source").default("MANUAL"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  orgIdx: index("historical_costs_org_idx").on(table.organizationId),
  scopeCategoryIdx: index("historical_costs_scope_category_idx").on(table.scopeCategory),
  tradeIdx: index("historical_costs_trade_idx").on(table.trade),
  costCodeIdx: index("historical_costs_cost_code_idx").on(table.costCode),
  completedDateIdx: index("historical_costs_completed_date_idx").on(table.completedDate),
}));

export const insertHistoricalCostSchema = createInsertSchema(historicalCosts).omit({
  id: true,
  createdAt: true,
});
export type InsertHistoricalCost = z.infer<typeof insertHistoricalCostSchema>;
export type HistoricalCost = typeof historicalCosts.$inferSelect;

export const overtimeRules = pgTable("overtime_rules", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull(),
  projectId: varchar("project_id").references(() => projects.id, { onDelete: "cascade" }),
  dailyThreshold: decimal("daily_threshold", { precision: 5, scale: 2 }).notNull().default("8"),
  weeklyThreshold: decimal("weekly_threshold", { precision: 5, scale: 2 }).notNull().default("40"),
  doubleTimeThreshold: decimal("double_time_threshold", { precision: 5, scale: 2 }),
  weeklyDtThreshold: decimal("weekly_dt_threshold", { precision: 5, scale: 2 }).default("60"),
  otMultiplier: decimal("ot_multiplier", { precision: 4, scale: 2 }).notNull().default("1.50"),
  dtMultiplier: decimal("dt_multiplier", { precision: 4, scale: 2 }).notNull().default("2.00"),
  consecutiveDayRule: boolean("consecutive_day_rule").notNull().default(false),
  consecutiveDayThreshold: integer("consecutive_day_threshold").default(7),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  orgIdx: index("overtime_rules_org_idx").on(table.organizationId),
  projectIdx: index("overtime_rules_project_idx").on(table.projectId),
}));

export const insertOvertimeRuleSchema = createInsertSchema(overtimeRules).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertOvertimeRule = z.infer<typeof insertOvertimeRuleSchema>;
export type OvertimeRule = typeof overtimeRules.$inferSelect;

export const costLedgerPostings = pgTable("cost_ledger_postings", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  payRunId: varchar("pay_run_id").notNull(),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  costCode: text("cost_code"),
  regularAmount: decimal("regular_amount", { precision: 12, scale: 2 }).notNull().default("0"),
  overtimeAmount: decimal("overtime_amount", { precision: 12, scale: 2 }).notNull().default("0"),
  doubleTimeAmount: decimal("double_time_amount", { precision: 12, scale: 2 }).notNull().default("0"),
  totalAmount: decimal("total_amount", { precision: 12, scale: 2 }).notNull().default("0"),
  burdenMultiplier: decimal("burden_multiplier", { precision: 5, scale: 4 }).notNull().default("1.0000"),
  burdenedTotalAmount: decimal("burdened_total_amount", { precision: 14, scale: 2 }).notNull().default("0"),
  regularHours: decimal("regular_hours", { precision: 8, scale: 2 }).notNull().default("0"),
  overtimeHours: decimal("overtime_hours", { precision: 8, scale: 2 }).notNull().default("0"),
  doubleTimeHours: decimal("double_time_hours", { precision: 8, scale: 2 }).notNull().default("0"),
  postedAt: timestamp("posted_at").notNull().defaultNow(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  payRunIdx: index("cost_ledger_postings_pay_run_idx").on(table.payRunId),
  projectIdx: index("cost_ledger_postings_project_idx").on(table.projectId),
  costCodeIdx: index("cost_ledger_postings_cost_code_idx").on(table.costCode),
}));

export const insertCostLedgerPostingSchema = createInsertSchema(costLedgerPostings).omit({ id: true, createdAt: true });
export type InsertCostLedgerPosting = z.infer<typeof insertCostLedgerPostingSchema>;
export type CostLedgerPosting = typeof costLedgerPostings.$inferSelect;

export const costTransactions = pgTable("cost_transactions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  costCode: text("cost_code").notNull().default("UNASSIGNED"),
  sourceCategory: costSourceCategoryEnum("source_category").notNull(),
  originModule: costOriginModuleEnum("origin_module").notNull(),
  amount: decimal("amount", { precision: 14, scale: 2 }).notNull(),
  transactionDate: date("transaction_date").notNull(),
  referenceId: varchar("reference_id"),
  description: text("description"),
  status: costTransactionStatusEnum("status").notNull().default("ACTIVE"),
  voidedAt: timestamp("voided_at"),
  voidedBy: varchar("voided_by").references(() => users.id),
  voidReason: text("void_reason"),
  createdBy: varchar("created_by").references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  projectIdx: index("cost_transactions_project_idx").on(table.projectId),
  costCodeIdx: index("cost_transactions_cost_code_idx").on(table.costCode),
  sourceCategoryIdx: index("cost_transactions_source_category_idx").on(table.sourceCategory),
  originModuleIdx: index("cost_transactions_origin_module_idx").on(table.originModule),
  statusIdx: index("cost_transactions_status_idx").on(table.status),
  transactionDateIdx: index("cost_transactions_transaction_date_idx").on(table.transactionDate),
  referenceIdx: index("cost_transactions_reference_idx").on(table.referenceId),
}));

export const insertCostTransactionSchema = createInsertSchema(costTransactions).omit({ id: true, createdAt: true });
export type InsertCostTransaction = z.infer<typeof insertCostTransactionSchema>;
export type CostTransaction = typeof costTransactions.$inferSelect;

export const projectNotePages = pgTable("project_note_pages", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  title: text("title").notNull().default("Untitled"),
  authorId: varchar("author_id").notNull().references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  projectIdIdx: index("project_note_pages_project_id_idx").on(table.projectId),
  authorIdIdx: index("project_note_pages_author_id_idx").on(table.authorId),
}));

export const insertProjectNotePageSchema = createInsertSchema(projectNotePages).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertProjectNotePage = z.infer<typeof insertProjectNotePageSchema>;
export type ProjectNotePage = typeof projectNotePages.$inferSelect;

export const projectNoteBlocks = pgTable("project_note_blocks", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  pageId: varchar("page_id").notNull().references(() => projectNotePages.id, { onDelete: "cascade" }),
  type: noteBlockTypeEnum("type").notNull().default("PARAGRAPH"),
  content: json("content").$type<{ text?: string }>().notNull().default({}),
  sortOrder: integer("sort_order").notNull().default(0),
  checked: boolean("checked").default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  pageIdIdx: index("project_note_blocks_page_id_idx").on(table.pageId),
  sortOrderIdx: index("project_note_blocks_sort_order_idx").on(table.sortOrder),
}));

export const insertProjectNoteBlockSchema = createInsertSchema(projectNoteBlocks).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertProjectNoteBlock = z.infer<typeof insertProjectNoteBlockSchema>;
export type ProjectNoteBlock = typeof projectNoteBlocks.$inferSelect;

export const mobilizationChecklists = pgTable("mobilization_checklists", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  description: text("description"),
  status: mobilizationChecklistStatusEnum("status").notNull().default("DRAFT"),
  completedAt: timestamp("completed_at"),
  completedById: varchar("completed_by_id").references(() => users.id, { onDelete: "set null" }),
  createdById: varchar("created_by_id").notNull().references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  projectIdIdx: index("mobilization_checklists_project_id_idx").on(table.projectId),
  statusIdx: index("mobilization_checklists_status_idx").on(table.status),
}));

export const insertMobilizationChecklistSchema = createInsertSchema(mobilizationChecklists).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertMobilizationChecklist = z.infer<typeof insertMobilizationChecklistSchema>;
export type MobilizationChecklist = typeof mobilizationChecklists.$inferSelect;

export const mobilizationChecklistItems = pgTable("mobilization_checklist_items", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  checklistId: varchar("checklist_id").notNull().references(() => mobilizationChecklists.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  description: text("description"),
  category: text("category").notNull().default("General"),
  sortOrder: integer("sort_order").notNull().default(0),
  status: mobilizationItemStatusEnum("status").notNull().default("PENDING"),
  assignedToUserId: varchar("assigned_to_user_id").references(() => users.id, { onDelete: "set null" }),
  assignedToName: text("assigned_to_name"),
  dueDate: timestamp("due_date"),
  completedAt: timestamp("completed_at"),
  completedById: varchar("completed_by_id").references(() => users.id, { onDelete: "set null" }),
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  checklistIdIdx: index("mobilization_checklist_items_checklist_id_idx").on(table.checklistId),
  statusIdx: index("mobilization_checklist_items_status_idx").on(table.status),
}));

export const insertMobilizationChecklistItemSchema = createInsertSchema(mobilizationChecklistItems).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertMobilizationChecklistItem = z.infer<typeof insertMobilizationChecklistItemSchema>;
export type MobilizationChecklistItem = typeof mobilizationChecklistItems.$inferSelect;

export const methodStatements = pgTable("method_statements", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  description: text("description"),
  workActivity: text("work_activity").notNull(),
  sequenceOfOperations: text("sequence_of_operations"),
  equipmentResources: text("equipment_resources"),
  hazards: text("hazards"),
  controlMeasures: text("control_measures"),
  ppe: text("ppe"),
  emergencyProcedures: text("emergency_procedures"),
  status: methodStatementStatusEnum("status").notNull().default("DRAFT"),
  linkedScheduleTaskId: varchar("linked_schedule_task_id"),
  linkedSafetyChecklistId: varchar("linked_safety_checklist_id"),
  submittedAt: timestamp("submitted_at"),
  submittedById: varchar("submitted_by_id").references(() => users.id, { onDelete: "set null" }),
  approvedAt: timestamp("approved_at"),
  approvedById: varchar("approved_by_id").references(() => users.id, { onDelete: "set null" }),
  rejectedAt: timestamp("rejected_at"),
  rejectionReason: text("rejection_reason"),
  createdById: varchar("created_by_id").notNull().references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  projectIdIdx: index("method_statements_project_id_idx").on(table.projectId),
  statusIdx: index("method_statements_status_idx").on(table.status),
}));

export const insertMethodStatementSchema = createInsertSchema(methodStatements).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertMethodStatement = z.infer<typeof insertMethodStatementSchema>;
export type MethodStatement = typeof methodStatements.$inferSelect;

export const projectPermits = pgTable("project_permits", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  permitType: permitTypeEnum("permit_type").notNull(),
  customType: text("custom_type"),
  permitNumber: text("permit_number"),
  status: permitStatusEnum("status").notNull().default("APPLIED"),
  issuingAuthority: text("issuing_authority"),
  appliedDate: date("applied_date"),
  issuedDate: date("issued_date"),
  expiryDate: date("expiry_date"),
  linkedInspectionIds: text("linked_inspection_ids"),
  linkedDocumentIds: text("linked_document_ids"),
  notes: text("notes"),
  createdById: varchar("created_by_id").notNull().references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  projectIdIdx: index("project_permits_project_id_idx").on(table.projectId),
  statusIdx: index("project_permits_status_idx").on(table.status),
  expiryDateIdx: index("project_permits_expiry_date_idx").on(table.expiryDate),
}));

export const insertProjectPermitSchema = createInsertSchema(projectPermits).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertProjectPermit = z.infer<typeof insertProjectPermitSchema>;
export type ProjectPermit = typeof projectPermits.$inferSelect;

export const materialTests = pgTable("material_tests", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  testNumber: text("test_number").notNull(),
  materialType: text("material_type").notNull(),
  testType: materialTestTypeEnum("test_type").notNull(),
  customTestType: text("custom_test_type"),
  sampleId: text("sample_id"),
  testDate: date("test_date").notNull(),
  labName: text("lab_name"),
  testResults: text("test_results"),
  status: materialTestStatusEnum("status").notNull().default("PENDING"),
  specRequirement: text("spec_requirement"),
  reportFileUrl: text("report_file_url"),
  reportFileName: text("report_file_name"),
  notes: text("notes"),
  punchListItemId: varchar("punch_list_item_id").references(() => punchListItems.id, { onDelete: "set null" }),
  createdById: varchar("created_by_id").notNull().references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  projectIdIdx: index("material_tests_project_id_idx").on(table.projectId),
  statusIdx: index("material_tests_status_idx").on(table.status),
  testTypeIdx: index("material_tests_test_type_idx").on(table.testType),
  testDateIdx: index("material_tests_test_date_idx").on(table.testDate),
}));

export const insertMaterialTestSchema = createInsertSchema(materialTests).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertMaterialTest = z.infer<typeof insertMaterialTestSchema>;
export type MaterialTest = typeof materialTests.$inferSelect;

export const ppeComplianceLogs = pgTable("ppe_compliance_logs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  checkDate: date("check_date").notNull(),
  workerName: text("worker_name").notNull(),
  workerUserId: varchar("worker_user_id").references(() => users.id, { onDelete: "set null" }),
  ppeType: ppeTypeEnum("ppe_type").notNull(),
  complianceStatus: ppeComplianceStatusEnum("compliance_status").notNull(),
  notes: text("notes"),
  checkedById: varchar("checked_by_id").notNull().references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  projectIdIdx: index("ppe_compliance_logs_project_id_idx").on(table.projectId),
  checkDateIdx: index("ppe_compliance_logs_check_date_idx").on(table.checkDate),
  statusIdx: index("ppe_compliance_logs_status_idx").on(table.complianceStatus),
}));

export const insertPpeComplianceLogSchema = createInsertSchema(ppeComplianceLogs).omit({ id: true, createdAt: true });
export type InsertPpeComplianceLog = z.infer<typeof insertPpeComplianceLogSchema>;
export type PpeComplianceLog = typeof ppeComplianceLogs.$inferSelect;

export const projectReports = pgTable("project_reports", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  reportType: projectReportTypeEnum("report_type").notNull(),
  title: text("title").notNull(),
  dateRangeStart: date("date_range_start").notNull(),
  dateRangeEnd: date("date_range_end").notNull(),
  status: projectReportStatusEnum("status").notNull().default("GENERATING"),
  generatedById: varchar("generated_by_id").references(() => users.id, { onDelete: "set null" }),
  reportData: jsonb("report_data"),
  pdfStorageKey: text("pdf_storage_key"),
  emailRecipients: text("email_recipients").array(),
  generatedAt: timestamp("generated_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  projectIdIdx: index("project_reports_project_id_idx").on(table.projectId),
  reportTypeIdx: index("project_reports_report_type_idx").on(table.reportType),
  dateRangeIdx: index("project_reports_date_range_idx").on(table.dateRangeStart, table.dateRangeEnd),
}));

export const insertProjectReportSchema = createInsertSchema(projectReports).omit({ id: true, createdAt: true });
export type InsertProjectReport = z.infer<typeof insertProjectReportSchema>;
export type ProjectReport = typeof projectReports.$inferSelect;

export const ganttPdfRenderSamples = pgTable("gantt_pdf_render_samples", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  startedAt: timestamp("started_at").notNull(),
  durationMs: integer("duration_ms").notNull(),
  success: boolean("success").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  startedAtIdx: index("gantt_pdf_render_samples_started_at_idx").on(table.startedAt),
}));

export const insertGanttPdfRenderSampleSchema = createInsertSchema(ganttPdfRenderSamples).omit({ id: true, createdAt: true });
export type InsertGanttPdfRenderSample = z.infer<typeof insertGanttPdfRenderSampleSchema>;
export type GanttPdfRenderSample = typeof ganttPdfRenderSamples.$inferSelect;

// ============================================
// PROJECT & WBS TEMPLATES (Task #889)
// Captures a project archetype (WBS task tree, dependencies, doc folders,
// distribution lists, custom field defaults, default cost codes, SoV
// structure, RFI/submittal categories) so new projects can be spun up from
// a known-good baseline. Templates are versioned: editing a template
// creates a new version while in-flight projects keep their original.
// ============================================
export const projectTemplates = pgTable("project_templates", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").references(() => organizations.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description"),
  category: text("category"),
  sourceProjectId: varchar("source_project_id").references(() => projects.id, { onDelete: "set null" }),
  sourceProjectCode: text("source_project_code"),
  isSystemSeed: boolean("is_system_seed").notNull().default(false),
  isActive: boolean("is_active").notNull().default(true),
  currentVersion: integer("current_version").notNull().default(1),
  usageCount: integer("usage_count").notNull().default(0),
  lastUsedAt: timestamp("last_used_at"),
  createdById: varchar("created_by_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  orgIdx: index("project_templates_org_idx").on(table.organizationId),
  systemSeedIdx: index("project_templates_system_seed_idx").on(table.isSystemSeed),
}));

export const projectTemplateVersions = pgTable("project_template_versions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  templateId: varchar("template_id").notNull().references(() => projectTemplates.id, { onDelete: "cascade" }),
  version: integer("version").notNull(),
  snapshot: jsonb("snapshot").notNull(),
  notes: text("notes"),
  createdById: varchar("created_by_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  templateIdx: index("project_template_versions_template_idx").on(table.templateId),
  uniqVersion: unique("project_template_versions_uniq").on(table.templateId, table.version),
}));

export const insertProjectTemplateSchema = createInsertSchema(projectTemplates).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  usageCount: true,
  lastUsedAt: true,
  currentVersion: true,
});
export type InsertProjectTemplate = z.infer<typeof insertProjectTemplateSchema>;
export type ProjectTemplate = typeof projectTemplates.$inferSelect;

export const insertProjectTemplateVersionSchema = createInsertSchema(projectTemplateVersions).omit({
  id: true,
  createdAt: true,
});
export type InsertProjectTemplateVersion = z.infer<typeof insertProjectTemplateVersionSchema>;
export type ProjectTemplateVersion = typeof projectTemplateVersions.$inferSelect;


// ============================================
// PORTFOLIO PDF RENDER SAMPLES (Task #940)
// One row per portfolio summary PDF render attempt; lets the alert monitor
// compute rolling failure rate and durations after restarts.
// ============================================
export const portfolioPdfRenderSamples = pgTable("portfolio_pdf_render_samples", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  startedAt: timestamp("started_at").notNull(),
  durationMs: integer("duration_ms").notNull(),
  success: boolean("success").notNull(),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  startedAtIdx: index("portfolio_pdf_render_samples_started_at_idx").on(table.startedAt),
}));

export const insertPortfolioPdfRenderSampleSchema = createInsertSchema(portfolioPdfRenderSamples).omit({ id: true, createdAt: true });
export type InsertPortfolioPdfRenderSample = z.infer<typeof insertPortfolioPdfRenderSampleSchema>;
export type PortfolioPdfRenderSample = typeof portfolioPdfRenderSamples.$inferSelect;


// ============================================
// CRM TRANSCRIPT BACKFILL NOTIFICATIONS (Task #1022)
// One audit row per dispatched run-completion email so the admin history page
// can show who was notified for each backfill run. Recipient emails are
// snapshotted (not joined to users.email) so the list survives admin role
// changes / departures after the run.
// ============================================
export const crmTranscriptBackfillNotifications = pgTable("crm_transcript_backfill_notifications", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  jobId: varchar("job_id").notNull().references(() => crmTranscriptBackfillJobs.id, { onDelete: "cascade" }),
  channel: text("channel").notNull().default("EMAIL"),
  recipientEmails: text("recipient_emails").array().notNull().default(sql`'{}'::text[]`),
  recipientCount: integer("recipient_count").notNull().default(0),
  notifiedAt: timestamp("notified_at").notNull().defaultNow(),
}, (table) => ({
  jobIdx: index("crm_transcript_backfill_notifications_job_idx").on(table.jobId),
  notifiedAtIdx: index("crm_transcript_backfill_notifications_notified_at_idx").on(table.notifiedAt),
}));

export const insertCrmTranscriptBackfillNotificationSchema = createInsertSchema(crmTranscriptBackfillNotifications).omit({
  id: true,
  notifiedAt: true,
});
export type InsertCrmTranscriptBackfillNotification = z.infer<typeof insertCrmTranscriptBackfillNotificationSchema>;
export type CrmTranscriptBackfillNotification = typeof crmTranscriptBackfillNotifications.$inferSelect;

// ============================================
// ALERT FALLBACK SENT (Task #1067)
// Persisted dedupe ledger for the alert-failure fan-out emails dispatched by
// `notifyOrgAdminsOfAlertDeliveryFailure`. The 1-hour de-duplication window
// previously lived in an in-memory Map per process, so a restart or fresh
// pod could let a continuously-broken webhook produce one extra fan-out
// email per deploy. Persisting (org, channel, recipient summary, error
// hash) -> sent_at lets every process consult the same ledger before it
// fans out, capping the noise to one email per dedupe window across the
// fleet. The in-memory cache is kept as a fast-path so the common case
// avoids a DB round-trip.
// ============================================
export const alertFallbackSent = pgTable(
  "alert_fallback_sent",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    orgId: varchar("org_id").notNull(),
    channel: text("channel").notNull(),
    recipientSummary: text("recipient_summary").notNull().default(""),
    errorHash: varchar("error_hash", { length: 64 }).notNull(),
    sentAt: timestamp("sent_at").notNull().defaultNow(),
  },
  (table) => ({
    lookupIdx: index("alert_fallback_sent_lookup_idx").on(
      table.orgId,
      table.channel,
      table.errorHash,
      table.sentAt,
    ),
  }),
);
export const insertAlertFallbackSentSchema = createInsertSchema(alertFallbackSent).omit({
  id: true,
  sentAt: true,
});
export type InsertAlertFallbackSent = z.infer<typeof insertAlertFallbackSentSchema>;
export type AlertFallbackSent = typeof alertFallbackSent.$inferSelect;

// ============================================
// CRM TRANSCRIPT BACKFILL ALERT RESEND COOLDOWNS (Task #1098)
// Persisted ledger backing the per-(org, job, channel) cooldown that keeps
// admins (or a script driving the admin button) from spamming Slack/Resend
// by mashing the "Resend" button on a failed transcript-backfill alert
// delivery. Task #1068 originally held this in a plain in-process Map, so
// the window reset every deploy/restart and was not shared across replicas.
// Storing the last successful reservation timestamp here lets every process
// across the fleet enforce the same 30-second window.
// ============================================
export const crmTranscriptBackfillAlertResendCooldowns = pgTable(
  "crm_transcript_backfill_alert_resend_cooldowns",
  {
    orgId: varchar("org_id").notNull(),
    jobId: varchar("job_id").notNull(),
    channel: text("channel").notNull(),
    lastResendAt: timestamp("last_resend_at").notNull().defaultNow(),
  },
  (table) => ({
    pk: unique("crm_transcript_backfill_alert_resend_cooldowns_pk").on(
      table.orgId,
      table.jobId,
      table.channel,
    ),
  }),
);
export type CrmTranscriptBackfillAlertResendCooldown =
  typeof crmTranscriptBackfillAlertResendCooldowns.$inferSelect;

// ============================================
// PLATFORM INCIDENT REVIEWS (Task #1578)
// Lightweight platform-support concept that lets SUPER_ADMINs file an
// incident review and attach the cross-org alert-failure CSVs (summary /
// samples / quiet) directly from the "Recent alert failures" card.
// Previously platform support had to download the CSV and re-upload it as
// an attachment; storing the review + attachment rows here lets the
// /api/crm/.../attach-to-incident-review handler stream the same CSV
// branch into Replit object storage and link it back to the review.
//
// Reviews are platform-wide (no organizationId — they are typically about
// a cross-org problem) and are limited to SUPER_ADMINs at the route layer.
// ============================================
export const platformIncidentReviews = pgTable(
  "platform_incident_reviews",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    title: text("title").notNull(),
    summary: text("summary"),
    status: text("status").notNull().default("OPEN"),
    createdById: varchar("created_by_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ({
    statusIdx: index("platform_incident_reviews_status_idx").on(
      table.status,
      table.createdAt,
    ),
  }),
);
export const insertPlatformIncidentReviewSchema = createInsertSchema(
  platformIncidentReviews,
).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertPlatformIncidentReview = z.infer<
  typeof insertPlatformIncidentReviewSchema
>;
export type PlatformIncidentReview =
  typeof platformIncidentReviews.$inferSelect;

// One row per CSV attached to an incident review. Captures the dataset
// branch ("summary" / "samples" / "quiet"), the windowHours used to
// generate it, the SUPER_ADMIN actor, and the object-storage key the CSV
// was streamed to, so the existing CSV audit row written by the
// alert-failures-digest.csv endpoint stays the single source of truth for
// "who pulled what, when" while the attachment row links the same pull to
// the review record.
export const platformIncidentReviewAttachments = pgTable(
  "platform_incident_review_attachments",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    reviewId: varchar("review_id")
      .notNull()
      .references(() => platformIncidentReviews.id, { onDelete: "cascade" }),
    source: text("source").notNull().default("alert_failures_digest"),
    dataset: text("dataset").notNull(),
    windowHours: integer("window_hours").notNull(),
    fileName: text("file_name").notNull(),
    objectKey: text("object_key").notNull(),
    fileSize: integer("file_size").notNull().default(0),
    contentType: text("content_type").notNull().default("text/csv"),
    orgRowCount: integer("org_row_count").notNull().default(0),
    sampleRowCount: integer("sample_row_count").notNull().default(0),
    attachedById: varchar("attached_by_id").references(() => users.id, {
      onDelete: "set null",
    }),
    attachedAt: timestamp("attached_at").notNull().defaultNow(),
  },
  (table) => ({
    reviewIdx: index("platform_incident_review_attachments_review_idx").on(
      table.reviewId,
      table.attachedAt,
    ),
  }),
);
export const insertPlatformIncidentReviewAttachmentSchema = createInsertSchema(
  platformIncidentReviewAttachments,
).omit({ id: true, attachedAt: true });
export type InsertPlatformIncidentReviewAttachment = z.infer<
  typeof insertPlatformIncidentReviewAttachmentSchema
>;
export type PlatformIncidentReviewAttachment =
  typeof platformIncidentReviewAttachments.$inferSelect;

// ---------------------------------------------------------------------------
// Task #2143 — Self-serve "Request access" flow.
//
// When a user hits a 403 (e.g. estimate PDF export gated on
// `hasManagementAccess`) the friendlier 403 toast now offers a
// "Request access" action that POSTs an `accessRequests` row and fans out
// an in-app + email notification to org admins. The admin "Access requests"
// tab in /company-settings?tab=users lets them approve (which bumps the
// user's role to `requestedRole` and/or flips the requested permission
// flags on `userDashboardPermissions`) or deny with a short note that
// notifies the requester. This closes the loop on task #2117's "ask an
// admin to grant it" toast — previously users had no in-app path to do so.
// ---------------------------------------------------------------------------
export const accessRequestStatusEnum = pgEnum("access_request_status", [
  "PENDING",
  "APPROVED",
  "DENIED",
]);

export const accessRequests = pgTable(
  "access_requests",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    organizationId: varchar("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    requesterUserId: varchar("requester_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // Optional role grant request (e.g. "MANAGER"). Null when the user is
    // only requesting a single feature flag.
    requestedRole: userRoleEnum("requested_role"),
    // Optional permission-flag grants. Each entry is a column name on
    // `user_dashboard_permissions` (e.g. "canViewProjectEstimates"). Stored
    // as a string array because this is a lightweight grant list, not a
    // full permission editor — admins can still tweak finer details from
    // the Feature Permissions tab.
    requestedPermissions: text("requested_permissions").array(),
    // Free-text label of what the user was trying to do, e.g.
    // "Export estimate PDF". Surfaced in the admin queue so they don't
    // have to chase the requester out-of-band.
    featureContext: text("feature_context"),
    // Why the user needs access. Required (>=5 chars) at the API layer.
    reason: text("reason").notNull(),
    status: accessRequestStatusEnum("status").notNull().default("PENDING"),
    decidedById: varchar("decided_by_id").references(() => users.id, {
      onDelete: "set null",
    }),
    decidedAt: timestamp("decided_at"),
    // Short note from the admin shown back to the requester on
    // approve/deny (e.g. "Use temp role then ping me Friday").
    decisionNote: text("decision_note"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ({
    orgStatusIdx: index("access_requests_org_status_idx").on(
      table.organizationId,
      table.status,
    ),
    requesterIdx: index("access_requests_requester_idx").on(
      table.requesterUserId,
    ),
  }),
);

export const insertAccessRequestSchema = createInsertSchema(accessRequests).omit({
  id: true,
  status: true,
  decidedById: true,
  decidedAt: true,
  decisionNote: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertAccessRequest = z.infer<typeof insertAccessRequestSchema>;
export type AccessRequest = typeof accessRequests.$inferSelect;

/**
 * Task #2220 — Takeoff stylus telemetry events.
 *
 * Anonymous, tenant-scoped log of the three pen/touch interactions whose
 * defaults Section 7 of the Takeoff Interaction Map currently tunes by
 * hand: palm-rejection drops, the long-press snap-HUD opening, and the
 * two-finger rotate gesture. Records only the values that triggered the
 * event (dwell ms, contact size px, rotation Δ°) plus device class and
 * pointer type — NO project / sheet / measurement / user identifiers
 * beyond `organizationId`, which mirrors the existing tenant scope on
 * `aiActionAudit` / `websiteAnalyticsEvents`. Backs the per-tenant
 * P50 / P95 distributions on the platform Stylus Tuning dashboard.
 */
export const takeoffStylusTelemetryEvents = pgTable(
  "takeoff_stylus_telemetry_events",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    organizationId: varchar("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    // PALM_REJECTED | LONG_PRESS | ROTATE_GESTURE — kept as text (not
    // an enum) so adding a new gesture later doesn't require a
    // migration. Server-side Zod restricts the accepted values.
    eventType: text("event_type").notNull(),
    // "pen" | "touch" | "mouse" — from PointerEvent.pointerType. We
    // don't UA-fingerprint beyond the device class below.
    pointerType: text("pointer_type"),
    // Coarse device class derived from userAgent on the client:
    // "ios" | "ipados" | "android" | "windows" | "macos" | "other".
    deviceClass: text("device_class"),
    // Measured long-press dwell (ms) — wall-clock elapsed from
    // pointer-down to the moment the HUD opened. Always >= the user's
    // configured threshold (`configuredThresholdMs` below); the gap
    // reflects timer/main-thread drift. The dashboard's P50/P95 dwell
    // therefore reports actual *behavioral* dwell, not the setting.
    dwellMs: integer("dwell_ms"),
    // Largest contact dimension in CSS px (PointerEvent width/height
    // or doubled Touch.radiusX/Y). Drives the palm-band tuning.
    contactSizePx: doublePrecision("contact_size_px"),
    // Cumulative rotation Δ in degrees for the gesture (signed:
    // positive = CCW). Only set on ROTATE_GESTURE events.
    rotationDeltaDeg: doublePrecision("rotation_delta_deg"),
    // Palm-rejection band (px) configured at the moment the touch was
    // dropped. Lets us interpret contactSizePx in context — a 30 px
    // contact rejected against a 24 px band is normal; against a
    // 60 px band it's not.
    bandPx: integer("band_px"),
    // Configured long-press hold threshold (ms) sourced from the
    // user's `stylus_long_press_ms` pref at the time of the event.
    // Stored alongside `dwellMs` so the dashboard can distinguish
    // setting-distribution (this column) from behavior (dwellMs).
    configuredThresholdMs: integer("configured_threshold_ms"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => ({
    orgCreatedIdx: index("takeoff_stylus_telemetry_org_created_idx").on(
      table.organizationId,
      table.createdAt,
    ),
    eventTypeIdx: index("takeoff_stylus_telemetry_event_type_idx").on(
      table.eventType,
    ),
  }),
);

export const insertTakeoffStylusTelemetryEventSchema = createInsertSchema(
  takeoffStylusTelemetryEvents,
).omit({ id: true, createdAt: true });
export type InsertTakeoffStylusTelemetryEvent = z.infer<
  typeof insertTakeoffStylusTelemetryEventSchema
>;
export type TakeoffStylusTelemetryEvent =
  typeof takeoffStylusTelemetryEvents.$inferSelect;
