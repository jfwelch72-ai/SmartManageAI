import { sql } from "drizzle-orm";
import { pgTable, text, varchar, boolean, timestamp, date, decimal, integer, pgEnum, doublePrecision, index, unique, json } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod";
import { aiNoteInsightCategoryEnum, aiNoteInsightSeverityEnum, aiNoteInsightSourceTypeEnum, aiTaskPriorityEnum, aiTaskStatusEnum, auditActionEnum, billingStatusEnum, calendarEventTypeEnum, changeOrderStatusEnum, clockEventTypeEnum, dailyReportLockStatusEnum, delayClaimStatusEnum, delayClaimTypeEnum, delayNotificationRecipientTypeEnum, delayNotificationStatusEnum, delayReasonEnum, delayResponsibilityEnum, delayStatusEnum, documentTypeEnum, dowelSizeEnum, estimateItemCategoryEnum, estimateLineItemSourceEnum, estimateStatusEnum, fileTypeEnum, inspectionRequestMethodEnum, inspectionStatusEnum, inspectionTypeEnum, invoiceMatchStatusEnum, materialResponsibilityEnum, mediaTypeEnum, noteTypeEnum, notificationTypeEnum, overageActionStatusEnum, overtimeRequestStatusEnum, photoCustodyActionEnum, poReceiptItemConditionEnum, poReceiptStatusEnum, procurementStatusEnum, purchaseOrderStatusEnum, purchaseRequestStatusEnum, rebarSizeEnum, salaryTypeEnum, sealerTypeEnum, shiftApprovalStatusEnum, stoneTypeEnum, taskSourceTypeEnum, tmBillingStatusEnum, tmInvoiceStatusEnum, tmTicketStatusEnum, underlaymentTypeEnum, vendorInvoiceStatusEnum, wireMeshTypeEnum } from "./enums";
import { bids, organizations, projects, users } from "./core";
import { aiRuns, crmOrganisations, organizationSowItems, quantityCategories, scopeWorkTypes } from "./features";

export const bidSubcontractorQuotes = pgTable("bid_subcontractor_quotes", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  bidId: varchar("bid_id").references(() => bids.id, { onDelete: "set null" }),
  projectId: varchar("project_id").references(() => projects.id, { onDelete: "cascade" }),
  subcontractorName: text("subcontractor_name").notNull(),
  scopeOfWork: text("scope_of_work").notNull(),
  quoteAmount: decimal("quote_amount", { precision: 12, scale: 2 }).notNull(),
  leadTime: text("lead_time"), // e.g., "2 weeks", "30 days"
  estimatedCompletionTime: text("estimated_completion_time"), // e.g., "3 months", "45 days"
  contactName: text("contact_name"),
  contactEmail: text("contact_email"),
  contactPhone: text("contact_phone"),
  notes: text("notes"),
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

// Plan Documents table
export const planDocuments = pgTable("plan_documents", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
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
  fringeRate: decimal("fringe_rate", { precision: 10, scale: 2 }).notNull().default("0"), // Fringe benefits
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

// T&M Daily Sheets table (legacy - replaced by tmTickets)
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
});

// Change Orders table
// Simplified workflow: DRAFT → SUBMITTED → APPROVED/REJECTED
export const changeOrders = pgTable("change_orders", {
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
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  statusIdx: index("change_orders_status_idx").on(table.status),
  projectIdIdx: index("change_orders_project_id_idx").on(table.projectId),
  workTypeCodeIdx: index("change_orders_work_type_code_idx").on(table.workTypeCode),
}));

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
  revisedById: varchar("revised_by_id").notNull().references(() => users.id),
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
  approvedById: varchar("approved_by_id").references(() => users.id),
  approvedAt: timestamp("approved_at"),
  createdById: varchar("created_by_id").notNull().references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  eventTypeIdx: index("calendar_events_event_type_idx").on(table.eventType),
  userIdIdx: index("calendar_events_user_id_idx").on(table.userId),
}));

// Notifications table
export const notifications = pgTable("notifications", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id),
  type: notificationTypeEnum("type").notNull(),
  title: text("title").notNull(),
  message: text("message").notNull(),
  isRead: boolean("is_read").notNull().default(false),
  relatedEntityId: varchar("related_entity_id"),
  relatedEntityType: text("related_entity_type"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  userIdIdx: index("notifications_user_id_idx").on(table.userId),
  userReadIdx: index("notifications_user_read_idx").on(table.userId, table.isRead),
  createdAtIdx: index("notifications_created_at_idx").on(table.createdAt),
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
  clockOutLatitude: doublePrecision("clock_out_latitude"),
  clockOutLongitude: doublePrecision("clock_out_longitude"),
  notes: text("notes"),
  autoClockOut: boolean("auto_clock_out").notNull().default(false),
  geofenceStatus: varchar("geofence_status", { length: 20 }),
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
  notes: text("notes"),
  performedById: varchar("performed_by_id").notNull().references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

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
  metadata: text("metadata"),
  
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
  
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  estimateIdx: index("estimate_line_items_estimate_idx").on(table.estimateId),
  categoryIdx: index("estimate_line_items_category_idx").on(table.category),
  sourceIdx: index("estimate_line_items_source_idx").on(table.source),
  scopeWorkTypeIdx: index("estimate_line_items_scope_work_type_idx").on(table.scopeWorkTypeId),
  workTypeCodeIdx: index("estimate_line_items_work_type_code_idx").on(table.workTypeCode),
  subcontractorQuoteIdx: index("estimate_line_items_subcontractor_quote_idx").on(table.subcontractorQuoteId),
  jobClassificationIdx: index("estimate_line_items_job_classification_idx").on(table.jobClassificationId),
  organizationSowItemIdx: index("estimate_line_items_org_sow_item_idx").on(table.organizationSowItemId),
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

export type InsertTMDailySheet = z.infer<typeof insertTMDailySheetSchema>;
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

export const insertEstimateLineItemSchema = createInsertSchema(estimateLineItems).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertEstimateLineItem = z.infer<typeof insertEstimateLineItemSchema>;
export type EstimateLineItem = typeof estimateLineItems.$inferSelect;

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
  approvedById: varchar("approved_by_id").references(() => users.id),
  approvedAt: timestamp("approved_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const purchaseRequestItems = pgTable("purchase_request_items", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  prId: varchar("pr_id").notNull().references(() => purchaseRequests.id, { onDelete: "cascade" }),
  description: text("description").notNull(),
  category: text("category"),
  quantity: decimal("quantity", { precision: 10, scale: 2 }),
  unit: text("unit"),
  estimatedUnitCost: decimal("estimated_unit_cost", { precision: 10, scale: 2 }),
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
  approvedById: varchar("approved_by_id").references(() => users.id),
  approvedAt: timestamp("approved_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const purchaseOrderItems = pgTable("purchase_order_items", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  poId: varchar("po_id").notNull().references(() => purchaseOrders.id, { onDelete: "cascade" }),
  prItemId: varchar("pr_item_id").references(() => purchaseRequestItems.id),
  description: text("description").notNull(),
  quantity: decimal("quantity", { precision: 10, scale: 2 }),
  unit: text("unit"),
  unitCost: decimal("unit_cost", { precision: 10, scale: 2 }),
  quantityReceived: decimal("quantity_received", { precision: 10, scale: 2 }).default("0"),
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
});

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

export const insertVendorInvoiceSchema = createInsertSchema(vendorInvoices).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertVendorInvoice = z.infer<typeof insertVendorInvoiceSchema>;
export type VendorInvoice = typeof vendorInvoices.$inferSelect;

export const insertInvoiceMatchSchema = createInsertSchema(invoiceMatches).omit({ id: true, createdAt: true });
export type InsertInvoiceMatch = z.infer<typeof insertInvoiceMatchSchema>;
export type InvoiceMatch = typeof invoiceMatches.$inferSelect;

