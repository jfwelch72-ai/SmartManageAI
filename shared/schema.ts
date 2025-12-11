import { sql } from "drizzle-orm";
import { pgTable, text, varchar, boolean, timestamp, date, decimal, integer, pgEnum, doublePrecision, index, unique } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod";

// Enums
export const userRoleEnum = pgEnum("user_role", ["SUPER_ADMIN", "ADMIN", "MANAGER", "SUPERINTENDENT", "ESTIMATOR", "OFFICE_MANAGER", "HOURLY_EMPLOYEE", "MAINTENANCE_MANAGER", "VENDOR", "HUSTLER"]);
export const projectStatusEnum = pgEnum("project_status", ["BID", "PLANNING", "ACTIVE", "COMPLETE", "CLOSED"]);
export const estimateStatusEnum = pgEnum("estimate_status", ["DRAFT", "SUBMITTED", "WON", "LOST", "PENDING_APPROVAL", "APPROVED", "REJECTED"]);
export const estimateLineItemSourceEnum = pgEnum("estimate_line_item_source", ["MANUAL", "TAKEOFF", "GENERATED"]);
export const procurementStatusEnum = pgEnum("procurement_status", ["PLANNED", "QUOTED", "APPROVED", "ORDERED", "DELIVERED"]);
export const documentTypeEnum = pgEnum("document_type", ["PLANS", "SPECS", "TAKEOFF", "OTHER"]);
export const noteTypeEnum = pgEnum("note_type", ["GENERAL", "FIELD_NOTE", "SAFETY", "CLIENT_MEETING"]);
export const mediaTypeEnum = pgEnum("media_type", ["IMAGE", "VIDEO"]);
export const billingStatusEnum = pgEnum("billing_status", ["NOT_READY", "READY_TO_BILL", "BILLED"]);
export const changeOrderStatusEnum = pgEnum("change_order_status", ["DRAFT", "PENDING_APPROVAL", "SUBMITTED", "APPROVED", "REJECTED"]);
export const calendarEventTypeEnum = pgEnum("calendar_event_type", ["TIME_OFF_REQUEST", "TIME_OFF_APPROVED", "NETWORKING_EVENT", "PROJECT_START", "PROJECT_PHASE", "PROJECT_MILESTONE"]);
export const notificationTypeEnum = pgEnum("notification_type", ["BILLING_READY", "CHANGE_ORDER_PENDING", "TIME_OFF_REQUEST", "GENERAL", "MATERIAL_OVERAGE", "PROJECT_ASSIGNMENT", "MAINTENANCE_REQUEST", "REPAIR_REQUEST", "DELAY_SUBMITTED", "DELAY_ACKNOWLEDGED", "DELAY_CHANGE_ORDER_NEEDED"]);

// Messaging enums
export const conversationTypeEnum = pgEnum("conversation_type", ["DIRECT", "GROUP", "COMPANY"]);
export const messageStatusEnum = pgEnum("message_status", ["SENT", "DELIVERED", "READ"]);
export const fileTypeEnum = pgEnum("file_type", ["MEDIA", "DOCUMENT", "RECEIPT"]);
export const auditActionEnum = pgEnum("audit_action", [
  "CREATE", "UPDATE", "DELETE", "APPROVE", "REJECT", "SUBMIT", 
  "CLOCK_IN", "CLOCK_OUT", "ADJUST",
  "REVOKE_TOKENS", "CREATE_BID_QUOTE", "UPDATE_BID_QUOTE", "DELETE_BID_QUOTE",
  "CREATE_BID_MATERIAL_QUOTE", "UPDATE_BID_MATERIAL_QUOTE", "DELETE_BID_MATERIAL_QUOTE"
]);
export const clockEventTypeEnum = pgEnum("clock_event_type", ["CLOCK_IN", "CLOCK_OUT", "ADJUSTMENT", "ADMIN_OVERRIDE", "AUTO_CLOCK_OUT"]);
export const shiftApprovalStatusEnum = pgEnum("shift_approval_status", ["PENDING", "APPROVED", "REJECTED"]);
export const aiNoteInsightCategoryEnum = pgEnum("ai_note_insight_category", ["SUPPLY_NEED", "EQUIPMENT_REPAIR", "WEATHER_DELAY", "CHANGE_ORDER", "SAFETY", "CLIENT_COMMUNICATION", "OTHER"]);
export const aiNoteInsightSeverityEnum = pgEnum("ai_note_insight_severity", ["LOW", "MEDIUM", "HIGH", "CRITICAL"]);
export const aiNoteInsightSourceTypeEnum = pgEnum("ai_note_insight_source_type", ["PROJECT", "COMPANY"]);
export const aiTaskStatusEnum = pgEnum("ai_task_status", ["PENDING", "IN_PROGRESS", "COMPLETED", "DISMISSED"]);
export const aiTaskPriorityEnum = pgEnum("ai_task_priority", ["CRITICAL", "HIGH", "MEDIUM", "LOW"]);
export const taskSourceTypeEnum = pgEnum("task_source_type", ["MANUAL", "EMAIL", "AI_GENERATED", "SYSTEM"]);

// CRM Enums
export const crmOrganisationTypeEnum = pgEnum("crm_organisation_type", ["CONTRACTOR", "SUBCONTRACTOR", "SUPPLIER", "VENDOR", "OWNER_REP", "RENTAL_VENDOR"]);
export const crmContactRoleEnum = pgEnum("crm_contact_role", ["PM", "ESTIMATOR", "SUPERINTENDENT", "SALES", "ACCOUNTS_PAYABLE", "ACCOUNTS_RECEIVABLE", "OWNER", "GENERAL_MANAGER", "FOREMAN", "OTHER"]);
export const crmPreferredContactEnum = pgEnum("crm_preferred_contact", ["EMAIL", "PHONE", "TEXT", "OTHER"]);
export const crmNoteTypeEnum = pgEnum("crm_note_type", ["CALL", "EMAIL", "MEETING", "HOT_LEAD", "COLD_LEAD", "FOLLOW_UP", "ISSUE", "GENERAL"]);

// Vendor Pricing Integration Enums
export const pricingSourceTypeEnum = pgEnum("pricing_source_type", ["MANUAL", "PRICEBOOK_IMPORT", "VENDOR_PORTAL"]);
export const vendorEnrollmentStatusEnum = pgEnum("vendor_enrollment_status", ["PENDING", "ACTIVE", "SUSPENDED", "REJECTED"]);
export const pricingApprovalStatusEnum = pgEnum("pricing_approval_status", ["PENDING_REVIEW", "APPROVED", "REJECTED", "AUTO_APPROVED"]);

// Delay Tracking Enums
export const delayReasonEnum = pgEnum("delay_reason", [
  "WEATHER", "GC_SCHEDULING", "OTHER_CONTRACTORS", "MATERIAL_DELIVERY", 
  "PERMIT_ISSUES", "INSPECTION_DELAY", "OWNER_DIRECTIVE", "DESIGN_CHANGES",
  "SITE_CONDITIONS", "LABOR_SHORTAGE", "OTHER"
]);
export const delayStatusEnum = pgEnum("delay_status", ["DRAFT", "SUBMITTED", "ACKNOWLEDGED", "RESOLVED"]);
export const delayResponsibilityEnum = pgEnum("delay_responsibility", ["OWNER", "GC", "SUBCONTRACTOR", "TFR", "FORCE_MAJEURE"]);
export const delayNotificationStatusEnum = pgEnum("delay_notification_status", ["DRAFT", "FINALIZED"]);
export const delayNotificationRecipientTypeEnum = pgEnum("delay_notification_recipient_type", ["OWNER_REP", "GC_REP", "OTHER"]);

// Inspection Scheduling Enums
export const inspectionTypeEnum = pgEnum("inspection_type", ["CITY_OFFICIAL", "GC_REPRESENTATIVE", "OWNER_REPRESENTATIVE"]);
export const inspectionStatusEnum = pgEnum("inspection_status", ["REQUESTED", "SCHEDULED", "PASSED", "FAILED", "CANCELLED"]);
export const inspectionRequestMethodEnum = pgEnum("inspection_request_method", ["CALL", "EMAIL", "PORTAL", "OTHER"]);

// White-Label / Multi-Tenant Enums - All 19 CSI Trade Divisions
export const tradeTypeEnum = pgEnum("trade_type", [
  "GENERAL_CONTRACTOR",    // CSI 00/01 - Full GC/CM
  "CONCRETE",              // CSI 03 - Concrete/Foundations  
  "EARTHWORK",             // CSI 31 - Excavation/Grading
  "ASPHALT_PAVING",        // CSI 32 - Asphalt & Striping
  "ROOFING",               // CSI 07 - Roofing & Waterproofing
  "ELECTRICAL",            // CSI 26 - Power & Lighting
  "PLUMBING",              // CSI 22 - Plumbing Systems
  "HVAC",                  // CSI 23 - Mechanical/HVAC
  "CARPENTRY",             // CSI 06 - Wood & Metal Framing
  "MASONRY",               // CSI 04 - Masonry/Stone
  "DRYWALL",               // CSI 09 - Drywall/Insulation/Acoustical
  "PAINTING",              // CSI 09 90 - Painting & Coatings
  "FLOORING",              // CSI 09 60 - All Flooring Types
  "LANDSCAPING",           // CSI 32 90 - Landscaping & Irrigation
  "DEMOLITION",            // CSI 02 - Demo & Hazmat
  "STEEL_ERECTION",        // CSI 05 - Structural Steel & Metals
  "GLAZING",               // CSI 08 - Doors/Frames/Windows/Glass
  "INSULATION",            // CSI 07 21 - Thermal & Acoustic Insulation
  "FIRE_PROTECTION",       // CSI 21 - Fire Sprinkler/Suppression
  "LOW_VOLTAGE",           // CSI 27/28 - Technology/Security/AV
  "SOLAR",                 // Renewable Energy/Solar Installation
  "WATERPROOFING",         // CSI 07 - Below Grade/Above Grade
  "OTHER"
]);
export const onboardingStatusEnum = pgEnum("onboarding_status", ["NOT_STARTED", "IN_PROGRESS", "COMPLETED"]);

// Organization Document Enums
export const organizationDocumentTypeEnum = pgEnum("organization_document_type", [
  "LOGO_PRIMARY",
  "LOGO_SECONDARY",
  "LETTERHEAD",
  "INSURANCE_CERT_GENERAL_LIABILITY",
  "INSURANCE_CERT_WORKERS_COMP",
  "INSURANCE_CERT_AUTO",
  "INSURANCE_CERT_UMBRELLA",
  "W9",
  "LICENSE",
  "BONDING_LETTER",
  "BANKING_INFO",
  "SAFETY_PROGRAM",
  "COMPANY_PROFILE",
  "TEMPLATE_OTHER"
]);
export const organizationDocumentVisibilityEnum = pgEnum("organization_document_visibility", ["PUBLIC", "INTERNAL", "CONFIDENTIAL"]);

// Organizations table (tenants/companies)
export const organizations = pgTable("organizations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  tradeType: tradeTypeEnum("trade_type").notNull().default("GENERAL_CONTRACTOR"),
  tradeName: text("trade_name"),
  logoUrl: text("logo_url"),
  primaryColor: text("primary_color"),
  secondaryColor: text("secondary_color"),
  accentColor: text("accent_color"),
  fontFamily: text("font_family"),
  websiteUrl: text("website_url"),
  region: text("region"),
  typicalCrewSize: integer("typical_crew_size"),
  address: text("address"),
  city: text("city"),
  state: text("state"),
  zipCode: text("zip_code"),
  phone: text("phone"),
  email: text("email"),
  onboardingStatus: onboardingStatusEnum("onboarding_status").notNull().default("NOT_STARTED"),
  onboardingData: text("onboarding_data"),
  terminologyJson: text("terminology_json"),
  themeExtractedAt: timestamp("theme_extracted_at"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertOrganizationSchema = createInsertSchema(organizations).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertOrganization = z.infer<typeof insertOrganizationSchema>;
export type Organization = typeof organizations.$inferSelect;

// Users table
export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").references(() => organizations.id, { onDelete: "set null" }),
  firstName: text("first_name").notNull(),
  lastName: text("last_name").notNull(),
  email: text("email").notNull().unique(),
  phone: text("phone"),
  role: userRoleEnum("role").notNull().default("HOURLY_EMPLOYEE"),
  isActive: boolean("is_active").notNull().default(true),
  passwordHash: text("password_hash").notNull(),
  tokenVersion: integer("token_version").notNull().default(0),
  costRateRegular: decimal("cost_rate_regular", { precision: 10, scale: 2 }),
  costRateOvertime: decimal("cost_rate_overtime", { precision: 10, scale: 2 }),
  walkthroughCompleted: boolean("walkthrough_completed").notNull().default(false),
  walkthroughStep: integer("walkthrough_step").notNull().default(0),
  walkthroughStartedAt: timestamp("walkthrough_started_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Projects table
export const projects = pgTable("projects", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  code: text("code").notNull().unique(),
  clientName: text("client_name").notNull(),
  clientContactName: text("client_contact_name"),
  clientContactEmail: text("client_contact_email"),
  clientContactPhone: text("client_contact_phone"),
  status: projectStatusEnum("status").notNull().default("PLANNING"),
  locationAddress: text("location_address"),
  city: text("city"),
  state: text("state"),
  startDate: timestamp("start_date"),
  endDate: timestamp("end_date"),
  estimatedCompletionDate: timestamp("estimated_completion_date"),
  description: text("description"),
  budget: decimal("budget", { precision: 12, scale: 2 }),
  contractAmount: decimal("contract_amount", { precision: 12, scale: 2 }),
  texturaDrawDate: date("textura_draw_date"),
  drawDayOfMonth: integer("draw_day_of_month"),
  estimatorId: varchar("estimator_id").references(() => users.id),
  superintendentId: varchar("superintendent_id").references(() => users.id),
  projectManagerId: varchar("project_manager_id").references(() => users.id),
  gcOrganizationId: varchar("gc_organization_id"),
  ownerRepOrganizationId: varchar("owner_rep_organization_id"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  statusIdx: index("projects_status_idx").on(table.status),
}));

// Bids table (separate from projects)
export const bids = pgTable("bids", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  code: text("code").notNull().unique(),
  clientName: text("client_name").notNull(),
  clientContactName: text("client_contact_name"),
  clientContactEmail: text("client_contact_email"),
  clientContactPhone: text("client_contact_phone"),
  bidAmount: decimal("bid_amount", { precision: 12, scale: 2 }),
  dueDate: timestamp("due_date"),
  locationAddress: text("location_address"),
  city: text("city"),
  state: text("state"),
  description: text("description"),
  estimatorId: varchar("estimator_id").references(() => users.id),
  gcOrganizationId: varchar("gc_organization_id"),
  ownerRepOrganizationId: varchar("owner_rep_organization_id"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Bid Subcontractor Quotes table
// During conversion: projectId added, bidId set to null when bid deleted
// Non-selected quotes preserved for later selection on project page
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
  isSelected: boolean("is_selected").notNull().default(false), // Selected quote transfers on award
  fileUrl: text("file_url"),
  fileName: text("file_name"),
  fileSize: integer("file_size"),
  mimeType: text("mime_type"),
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

// Time Entries table
export const timeEntries = pgTable("time_entries", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  date: timestamp("date").notNull(),
  hoursRegular: decimal("hours_regular", { precision: 4, scale: 2 }).notNull().default("0"),
  hoursOvertime: decimal("hours_overtime", { precision: 4, scale: 2 }).notNull().default("0"),
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
export const tmTicketStatusEnum = pgEnum("tm_ticket_status", ["DRAFT", "SUBMITTED", "APPROVED", "REJECTED"]);

// T&M Work Tickets table - comprehensive tracking for time & material work
export const tmTickets = pgTable("tm_tickets", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  ticketNumber: text("ticket_number").notNull(),
  workDate: date("work_date").notNull(),
  tfrRepresentativeId: varchar("tfr_representative_id").notNull().references(() => users.id),
  workOrderReference: text("work_order_reference"),
  
  // Standardized scope of work (matches estimating sheets for production rate tracking)
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
  
  createdById: varchar("created_by_id").notNull().references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  projectIdIdx: index("tm_tickets_project_id_idx").on(table.projectId),
  statusIdx: index("tm_tickets_status_idx").on(table.status),
  workDateIdx: index("tm_tickets_work_date_idx").on(table.workDate),
  workTypeCodeIdx: index("tm_tickets_work_type_code_idx").on(table.workTypeCode),
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
export const updateTaskSchema = insertTaskSchema.partial();
export type Task = typeof tasks.$inferSelect;
export type InsertTask = z.infer<typeof insertTaskSchema>;

// Material responsibility enum - who is responsible for material overages
export const materialResponsibilityEnum = pgEnum("material_responsibility", [
  "TFR",           // TFR is responsible (absorb cost)
  "SUBCONTRACTOR", // Subcontractor is responsible (deduct from payment)
  "CUSTOMER",      // Customer is responsible (bill as change order)
  "PENDING",       // Not yet determined
]);

// Overage action status enum
export const overageActionStatusEnum = pgEnum("overage_action_status", [
  "NONE",       // No overage or no action needed
  "PENDING",    // Overage detected, awaiting decision
  "BILLED",     // Billed to customer
  "DEDUCTED",   // Deducted from subcontractor
  "ABSORBED",   // Absorbed by TFR
  "RESOLVED",   // Resolved through other means
]);

// Scope of Work Items table
export const scopeItems = pgTable("scope_items", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  estimateLineItemId: varchar("estimate_line_item_id").references(() => estimateLineItems.id, { onDelete: "set null" }),
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
}));

// Daily Scope Progress table - tracks daily quantities completed for each scope item
// Also captures production rate data: labor hours, costs, crew size for historical analysis
export const dailyScopeProgress = pgTable("daily_scope_progress", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  scopeItemId: varchar("scope_item_id").notNull().references(() => scopeItems.id, { onDelete: "cascade" }),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
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
});

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
});

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

// AI Settings table
export const aiSettings = pgTable("ai_settings", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  dailyRunsEnabled: boolean("daily_runs_enabled").notNull().default(true),
  dailyRunTime: text("daily_run_time").notNull().default("06:00"),
  roleTasksEnabled: boolean("role_tasks_enabled").notNull().default(true),
  billingAlertsEnabled: boolean("billing_alerts_enabled").notNull().default(true),
  profitabilityWarningsEnabled: boolean("profitability_warnings_enabled").notNull().default(true),
  crewSchedulingEnabled: boolean("crew_scheduling_enabled").notNull().default(true),
  bidRemindersEnabled: boolean("bid_reminders_enabled").notNull().default(true),
  materialOrderingEnabled: boolean("material_ordering_enabled").notNull().default(true),
  modelName: text("model_name").notNull().default("gpt-4o"),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// AI Runs table
export const aiRuns = pgTable("ai_runs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  runType: text("run_type").notNull().default("daily"),
  status: text("status").notNull().default("in_progress"),
  triggeredById: varchar("triggered_by_id").references(() => users.id),
  snapshotData: text("snapshot_data"),
  profitabilityData: text("profitability_data"),
  aiResponse: text("ai_response"),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  completedAt: timestamp("completed_at"),
}, (table) => ({
  createdAtIdx: index("ai_runs_created_at_idx").on(table.createdAt),
}));

// AI Tasks table (role-based prioritized tasks)
export const aiTasks = pgTable("ai_tasks", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  runId: varchar("run_id").notNull().references(() => aiRuns.id, { onDelete: "cascade" }),
  taskType: text("task_type").notNull(),
  role: userRoleEnum("role").notNull(),
  title: text("title").notNull(),
  description: text("description").notNull(),
  priority: aiTaskPriorityEnum("priority").notNull().default("MEDIUM"),
  status: aiTaskStatusEnum("status").notNull().default("PENDING"),
  dueDate: timestamp("due_date"),
  projectId: varchar("project_id").references(() => projects.id, { onDelete: "cascade" }),
  projectCode: text("project_code"),
  metadata: text("metadata"),
  assignedToId: varchar("assigned_to_id").references(() => users.id, { onDelete: "set null" }),
  completedAt: timestamp("completed_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  roleIdx: index("ai_tasks_role_idx").on(table.role),
  statusIdx: index("ai_tasks_status_idx").on(table.status),
  priorityIdx: index("ai_tasks_priority_idx").on(table.priority),
}));

// AI Insight Module Types
export const aiInsightModuleEnum = pgEnum("ai_insight_module", [
  "SCHEDULING",
  "DELAYS", 
  "COSTS",
  "EQUIPMENT",
  "VENDOR_PRICING",
  "PROJECT_HEALTH",
  "GANTT_CHART",
  "LABOR",
  "BIDS",
  "CHANGE_ORDERS"
]);

export const aiInsightSeverityEnum = pgEnum("ai_insight_severity", [
  "INFO",
  "SUGGESTION",
  "WARNING",
  "CRITICAL"
]);

// AI Insights table (module-specific AI analysis and recommendations)
export const aiInsights = pgTable("ai_insights", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").references(() => organizations.id, { onDelete: "cascade" }),
  projectId: varchar("project_id").references(() => projects.id, { onDelete: "cascade" }),
  module: aiInsightModuleEnum("module").notNull(),
  severity: aiInsightSeverityEnum("severity").notNull().default("INFO"),
  title: text("title").notNull(),
  summary: text("summary").notNull(),
  details: text("details"),
  recommendations: text("recommendations").array(),
  metrics: text("metrics"), // JSON string for module-specific metrics
  affectedEntities: text("affected_entities"), // JSON string for related IDs
  estimatedImpact: text("estimated_impact"), // Cost/time impact description
  actionItems: text("action_items"), // JSON string for specific actions
  isAcknowledged: boolean("is_acknowledged").notNull().default(false),
  acknowledgedById: varchar("acknowledged_by_id").references(() => users.id),
  acknowledgedAt: timestamp("acknowledged_at"),
  triggeredById: varchar("triggered_by_id").references(() => users.id),
  expiresAt: timestamp("expires_at"), // Insights can auto-expire
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  moduleIdx: index("ai_insights_module_idx").on(table.module),
  orgIdx: index("ai_insights_org_idx").on(table.organizationId),
  projectIdx: index("ai_insights_project_idx").on(table.projectId),
  severityIdx: index("ai_insights_severity_idx").on(table.severity),
  createdAtIdx: index("ai_insights_created_at_idx").on(table.createdAt),
}));

// AI Gantt Recommendations (AI-generated scheduling suggestions)
export const aiGanttRecommendations = pgTable("ai_gantt_recommendations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  insightId: varchar("insight_id").references(() => aiInsights.id, { onDelete: "cascade" }),
  recommendationType: text("recommendation_type").notNull(), // TASK_ORDER, RESOURCE_ALLOCATION, CRITICAL_PATH, PARALLEL_WORK
  title: text("title").notNull(),
  description: text("description").notNull(),
  suggestedTasks: text("suggested_tasks"), // JSON array of task suggestions
  suggestedDependencies: text("suggested_dependencies"), // JSON array of dependencies
  estimatedDaysImprovement: integer("estimated_days_improvement"),
  estimatedCostSavings: decimal("estimated_cost_savings", { precision: 12, scale: 2 }),
  isApplied: boolean("is_applied").notNull().default(false),
  appliedById: varchar("applied_by_id").references(() => users.id),
  appliedAt: timestamp("applied_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  projectIdx: index("ai_gantt_recommendations_project_idx").on(table.projectId),
}));

// AI Vendor Comparisons (best pricing analysis)
export const aiVendorComparisons = pgTable("ai_vendor_comparisons", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  insightId: varchar("insight_id").references(() => aiInsights.id, { onDelete: "cascade" }),
  materialCategory: text("material_category").notNull(),
  analysisData: text("analysis_data").notNull(), // JSON with vendor comparisons
  recommendedVendorId: varchar("recommended_vendor_id"),
  recommendedVendorName: text("recommended_vendor_name"),
  potentialSavings: decimal("potential_savings", { precision: 12, scale: 2 }),
  priceConfidence: integer("price_confidence"), // 0-100 confidence score
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  orgIdx: index("ai_vendor_comparisons_org_idx").on(table.organizationId),
  categoryIdx: index("ai_vendor_comparisons_category_idx").on(table.materialCategory),
}));

// AI Bid Document Analysis (AI-powered bid invitation/scope document review)
export const aiBidDocumentAnalysisStatusEnum = pgEnum("ai_bid_document_analysis_status", ["PENDING", "PROCESSING", "COMPLETED", "FAILED"]);

export const aiBidDocumentAnalysis = pgTable("ai_bid_document_analysis", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  bidId: varchar("bid_id").references(() => bids.id, { onDelete: "cascade" }),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  documentUrl: text("document_url").notNull(),
  documentName: text("document_name").notNull(),
  documentType: text("document_type"), // PDF, IMAGE, etc.
  status: aiBidDocumentAnalysisStatusEnum("status").notNull().default("PENDING"),
  
  // Extracted information
  projectName: text("project_name"),
  clientName: text("client_name"),
  bidDueDate: timestamp("bid_due_date"),
  projectLocation: text("project_location"),
  projectScope: text("project_scope"), // Full scope description
  scopeSummary: text("scope_summary"), // Short summary
  
  // Extracted line items as JSON array
  lineItems: text("line_items"), // JSON: [{description, quantity, unit, notes}]
  
  // Special requirements/qualifications
  requirements: text("requirements"), // JSON array of requirements
  qualifications: text("qualifications"), // JSON array of qualifications needed
  insuranceRequirements: text("insurance_requirements"),
  bondingRequirements: text("bonding_requirements"),
  
  // Pricing guidance
  suggestedPricingFactors: text("suggested_pricing_factors"), // JSON with pricing considerations
  riskFactors: text("risk_factors"), // JSON array of potential risks
  
  // Raw AI response for debugging
  rawAiResponse: text("raw_ai_response"),
  confidenceScore: integer("confidence_score"), // 0-100
  
  analyzedById: varchar("analyzed_by_id").references(() => users.id),
  analyzedAt: timestamp("analyzed_at"),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  bidIdx: index("ai_bid_document_analysis_bid_idx").on(table.bidId),
  orgIdx: index("ai_bid_document_analysis_org_idx").on(table.organizationId),
  statusIdx: index("ai_bid_document_analysis_status_idx").on(table.status),
}));

// AI Contract/Award Document Analysis (AI-powered award/contract document review)
export const aiContractDocumentAnalysisStatusEnum = pgEnum("ai_contract_document_analysis_status", ["PENDING", "PROCESSING", "COMPLETED", "FAILED"]);

export const aiContractDocumentAnalysis = pgTable("ai_contract_document_analysis", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: varchar("project_id").references(() => projects.id, { onDelete: "cascade" }),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  documentUrl: text("document_url").notNull(),
  documentName: text("document_name").notNull(),
  documentType: text("document_type"), // PDF, IMAGE, etc.
  status: aiContractDocumentAnalysisStatusEnum("status").notNull().default("PENDING"),
  
  // Contract basics
  contractType: text("contract_type"), // Subcontract, Prime Contract, Change Order, Amendment
  contractNumber: text("contract_number"),
  contractDate: timestamp("contract_date"),
  effectiveDate: timestamp("effective_date"),
  completionDate: timestamp("completion_date"),
  
  // Parties
  ownerName: text("owner_name"),
  generalContractorName: text("general_contractor_name"),
  subcontractorName: text("subcontractor_name"),
  ownerAddress: text("owner_address"),
  gcAddress: text("gc_address"),
  projectName: text("project_name"),
  projectLocation: text("project_location"),
  
  // Contract value and payment
  contractValue: decimal("contract_value", { precision: 14, scale: 2 }),
  retainage: decimal("retainage", { precision: 5, scale: 2 }), // Percentage
  paymentTerms: text("payment_terms"),
  billingSchedule: text("billing_schedule"), // Monthly, milestone-based, etc.
  
  // Scope and work
  scopeOfWork: text("scope_of_work"), // Full scope description
  scopeSummary: text("scope_summary"), // Short summary
  scopeItems: text("scope_items"), // JSON: [{section, description, inclusions, exclusions}]
  exclusions: text("exclusions"), // JSON array of explicit exclusions
  
  // Schedule
  startDate: timestamp("start_date"),
  duration: text("duration"), // "90 days", "3 months", etc.
  milestones: text("milestones"), // JSON: [{name, date, description}]
  liquidatedDamages: text("liquidated_damages"),
  
  // Insurance and bonding
  insuranceRequirements: text("insurance_requirements"), // JSON with limits
  bondingRequirements: text("bonding_requirements"),
  
  // Terms and conditions
  warrantyTerms: text("warranty_terms"),
  changeOrderProcess: text("change_order_process"),
  disputeResolution: text("dispute_resolution"),
  terminationClauses: text("termination_clauses"),
  indemnificationClauses: text("indemnification_clauses"),
  
  // Key clauses extracted
  keyTerms: text("key_terms"), // JSON: [{term, summary, section}]
  riskFactors: text("risk_factors"), // JSON: [{risk, severity, mitigation, section}]
  obligations: text("obligations"), // JSON: [{type, description, deadline}]
  
  // Raw AI response for debugging
  rawAiResponse: text("raw_ai_response"),
  confidenceScore: integer("confidence_score"), // 0-100
  
  analyzedById: varchar("analyzed_by_id").references(() => users.id),
  analyzedAt: timestamp("analyzed_at"),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  projectIdx: index("ai_contract_document_analysis_project_idx").on(table.projectId),
  orgIdx: index("ai_contract_document_analysis_org_idx").on(table.organizationId),
  statusIdx: index("ai_contract_document_analysis_status_idx").on(table.status),
}));

// ==================================================
// TAKEOFF + ESTIMATING ENGINE TABLES
// ==================================================

// Enums for takeoff and estimating
export const measurementTypeEnum = pgEnum("measurement_type", ["LINEAR", "AREA", "VOLUME", "COUNT", "NOTE"]);
export const measurementSourceEnum = pgEnum("measurement_source", ["USER", "AI"]);
export const measurementStatusEnum = pgEnum("measurement_status", ["DRAFT", "CONFIRMED"]);
export const scopeTypeEnum = pgEnum("scope_type", ["CONCRETE", "EXCAVATION", "PAVERS", "BOLLARDS", "UNDERDRAIN", "BASE", "BEDDING", "GENERAL"]);
export const estimateItemCategoryEnum = pgEnum("estimate_item_category", ["CONCRETE", "EXCAVATION", "PAVERS", "BOLLARDS", "GC", "OVERHEAD", "PROFIT", "GENERAL"]);

// Project Plans table (for uploaded PDFs)
export const projectPlans = pgTable("project_plans", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  documentId: varchar("document_id").references(() => planDocuments.id, { onDelete: "set null" }),
  originalPdfUrl: text("original_pdf_url").notNull(),
  fileName: text("file_name").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Quantity Categories table (for organizing measurements by scope/type)
export const quantityCategories = pgTable("quantity_categories", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  color: text("color").notNull().default("#3b82f6"),
  displayOrder: integer("display_order").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  projectIdx: index("quantity_categories_project_idx").on(table.projectId),
}));

// Takeoff Sheets table (per-page images from PDFs)
export const takeoffSheets = pgTable("takeoff_sheets", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  planId: varchar("plan_id").references(() => projectPlans.id, { onDelete: "cascade" }),
  imageUrl: text("image_url").notNull(),
  sheetIndex: integer("sheet_index").notNull().default(0),
  sheetName: text("sheet_name"),
  scalePxPerFoot: doublePrecision("scale_px_per_foot"),
  units: text("units").notNull().default("ft"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  projectIdx: index("takeoff_sheets_project_idx").on(table.projectId),
  planIdx: index("takeoff_sheets_plan_idx").on(table.planId),
}));

// Takeoff Measurements table
export const takeoffMeasurements = pgTable("takeoff_measurements", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  sheetId: varchar("sheet_id").notNull().references(() => takeoffSheets.id, { onDelete: "cascade" }),
  categoryId: varchar("category_id").references(() => quantityCategories.id, { onDelete: "set null" }),
  type: measurementTypeEnum("type").notNull(),
  label: text("label").notNull(),
  points: text("points").notNull(),
  arcData: text("arc_data"),
  depthFeet: doublePrecision("depth_feet"),
  count: integer("count"),
  note: text("note"),
  color: text("color").default("#3b82f6"),
  visible: boolean("visible").notNull().default(true),
  source: measurementSourceEnum("source").notNull().default("USER"),
  status: measurementStatusEnum("status").notNull().default("DRAFT"),
  computedLengthFt: doublePrecision("computed_length_ft"),
  computedAreaFt2: doublePrecision("computed_area_ft2"),
  computedVolumeCy: doublePrecision("computed_volume_cy"),
  metadata: text("metadata"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  sheetIdx: index("takeoff_measurements_sheet_idx").on(table.sheetId),
  categoryIdx: index("takeoff_measurements_category_idx").on(table.categoryId),
  typeIdx: index("takeoff_measurements_type_idx").on(table.type),
  statusIdx: index("takeoff_measurements_status_idx").on(table.status),
}));

// Project Specs table (uploaded spec books)
export const projectSpecs = pgTable("project_specs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  fileUrl: text("file_url").notNull(),
  originalFileName: text("original_file_name").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Project Spec Index table (AI-generated index of specs)
export const projectSpecIndex = pgTable("project_spec_index", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  data: text("data").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Estimate Settings table (global cost settings and rates)
export const estimateSettings = pgTable("estimate_settings", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  defaultMaterialPrices: text("default_material_prices").notNull().default('{}'),
  defaultLaborRates: text("default_labor_rates").notNull().default('{}'),
  defaultEquipmentRates: text("default_equipment_rates").notNull().default('{}'),
  defaultProductionRates: text("default_production_rates").notNull().default('{}'),
  defaultOverheadPercent: doublePrecision("default_overhead_percent").notNull().default(15),
  defaultProfitMarginPercent: doublePrecision("default_profit_margin_percent").notNull().default(20),
  defaultMarkups: text("default_markups").notNull().default('{}'),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Estimate Crews table (crew definitions and production rates)
export const estimateCrews = pgTable("estimate_crews", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  description: text("description"),
  members: text("members").notNull().default('[]'),
  blendedRatePerHour: decimal("blended_rate_per_hour", { precision: 10, scale: 2 }).notNull(),
  productionRateMapping: text("production_rate_mapping").notNull().default('{}'),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Stone type enum for sub-base calculations
export const stoneTypeEnum = pgEnum("stone_type", ["CRUSHED_STONE", "LIMESTONE", "COMPACTED_BASE", "PEA_GRAVEL", "RECYCLED_CONCRETE"]);

// Material calculator enums for reinforcement and additives
export const wireMeshTypeEnum = pgEnum("wire_mesh_type", ["6X6_W1.4_W1.4", "6X6_W2.9_W2.9", "4X4_W1.4_W1.4", "4X4_W2.9_W2.9"]);
export const rebarSizeEnum = pgEnum("rebar_size", ["#3", "#4", "#5", "#6"]);
export const sealerTypeEnum = pgEnum("sealer_type", ["CURE_AND_SEAL", "PENETRATING", "ACRYLIC", "EPOXY"]);
export const underlaymentTypeEnum = pgEnum("underlayment_type", ["POLY_6MIL", "POLY_10MIL", "VAPOR_BARRIER"]);
export const dowelSizeEnum = pgEnum("dowel_size", ["3/4_INCH", "1_INCH", "1_1/4_INCH"]);

// Estimate Line Items table (detailed cost breakdown per line)
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
}));

// Estimate Versions table (snapshots of estimates)
export const estimateVersions = pgTable("estimate_versions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  estimateId: varchar("estimate_id").notNull().references(() => estimates.id, { onDelete: "cascade" }),
  versionNumber: integer("version_number").notNull(),
  snapshot: text("snapshot").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  estimateIdx: index("estimate_versions_estimate_idx").on(table.estimateId),
}));

// Estimate Vendor Quotes table (uploaded vendor/material quotes)
export const estimateVendorQuotes = pgTable("estimate_vendor_quotes", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  estimateId: varchar("estimate_id").notNull().references(() => estimates.id, { onDelete: "cascade" }),
  vendorName: text("vendor_name").notNull(),
  contactInfo: text("contact_info"),
  scopeDescription: text("scope_description").notNull(),
  quoteAmount: decimal("quote_amount", { precision: 12, scale: 2 }).notNull(),
  fileUrl: text("file_url"),
  fileName: text("file_name"),
  fileSize: integer("file_size"),
  mimeType: text("mime_type"),
  linkedLineItemIds: text("linked_line_item_ids").notNull().default('[]'),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  estimateIdx: index("estimate_vendor_quotes_estimate_idx").on(table.estimateId),
}));

// Estimate History table (for production rate tracking)
export const estimateHistory = pgTable("estimate_history", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  estimateId: varchar("estimate_id").references(() => estimates.id, { onDelete: "cascade" }),
  data: text("data").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// Insert and Select Schemas
export const insertUserSchema = createInsertSchema(users).omit({
  id: true,
  tokenVersion: true,
  createdAt: true,
  updatedAt: true,
});

// Password Reset Tokens table
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

export const insertProjectSchema = createInsertSchema(projects).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertBidSchema = createInsertSchema(bids).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

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
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;
export type SelectUser = Omit<User, 'passwordHash'>;

export type InsertProject = z.infer<typeof insertProjectSchema>;
export type Project = typeof projects.$inferSelect;

export type InsertBid = z.infer<typeof insertBidSchema>;
export type Bid = typeof bids.$inferSelect;

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

export type InsertTMDailySheet = z.infer<typeof insertTMDailySheetSchema>;
export type TMDailySheet = typeof tmDailySheets.$inferSelect;

// T&M Ticket schemas and types
export const insertTMTicketSchema = createInsertSchema(tmTickets).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  submittedAt: true,
  approvedAt: true,
  rejectedAt: true,
  signedDocumentUploadedAt: true,
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
export type TimeClockEvent = typeof timeClockEvents.$inferSelect;

export const insertAISettingsSchema = createInsertSchema(aiSettings).omit({
  id: true,
  updatedAt: true,
});

export const insertAIRunSchema = createInsertSchema(aiRuns).omit({
  id: true,
  createdAt: true,
  completedAt: true,
});

export const insertAITaskSchema = createInsertSchema(aiTasks).omit({
  id: true,
  createdAt: true,
  completedAt: true,
});

export type InsertAISettings = z.infer<typeof insertAISettingsSchema>;
export type AISettings = typeof aiSettings.$inferSelect;

export type InsertAIRun = z.infer<typeof insertAIRunSchema>;
export type AIRun = typeof aiRuns.$inferSelect;

export type InsertAITask = z.infer<typeof insertAITaskSchema>;
export type AITask = typeof aiTasks.$inferSelect;

// AI Insights schemas and types
export const insertAIInsightSchema = createInsertSchema(aiInsights).omit({
  id: true,
  createdAt: true,
  acknowledgedAt: true,
});
export type InsertAIInsight = z.infer<typeof insertAIInsightSchema>;
export type AIInsight = typeof aiInsights.$inferSelect;

export const insertAIGanttRecommendationSchema = createInsertSchema(aiGanttRecommendations).omit({
  id: true,
  createdAt: true,
  appliedAt: true,
});
export type InsertAIGanttRecommendation = z.infer<typeof insertAIGanttRecommendationSchema>;
export type AIGanttRecommendation = typeof aiGanttRecommendations.$inferSelect;

export const insertAIVendorComparisonSchema = createInsertSchema(aiVendorComparisons).omit({
  id: true,
  createdAt: true,
});
export type InsertAIVendorComparison = z.infer<typeof insertAIVendorComparisonSchema>;
export type AIVendorComparison = typeof aiVendorComparisons.$inferSelect;

export const insertAIBidDocumentAnalysisSchema = createInsertSchema(aiBidDocumentAnalysis).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertAIBidDocumentAnalysis = z.infer<typeof insertAIBidDocumentAnalysisSchema>;
export type AIBidDocumentAnalysis = typeof aiBidDocumentAnalysis.$inferSelect;

export const insertAIContractDocumentAnalysisSchema = createInsertSchema(aiContractDocumentAnalysis).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertAIContractDocumentAnalysis = z.infer<typeof insertAIContractDocumentAnalysisSchema>;
export type AIContractDocumentAnalysis = typeof aiContractDocumentAnalysis.$inferSelect;

// Crews table
export const crews = pgTable("crews", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  description: text("description"),
  leadId: varchar("lead_id").references(() => users.id),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertCrewSchema = createInsertSchema(crews).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertCrew = z.infer<typeof insertCrewSchema>;
export type Crew = typeof crews.$inferSelect;

// Crew Members table
export const crewMembers = pgTable("crew_members", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  crewId: varchar("crew_id").notNull().references(() => crews.id, { onDelete: "cascade" }),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  role: text("role"),
  addedAt: timestamp("added_at").notNull().defaultNow(),
});

export const insertCrewMemberSchema = createInsertSchema(crewMembers).omit({ id: true, addedAt: true });
export type InsertCrewMember = z.infer<typeof insertCrewMemberSchema>;
export type CrewMember = typeof crewMembers.$inferSelect;

// Skills table
export const skills = pgTable("skills", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull().unique(),
  category: text("category"),
  description: text("description"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertSkillSchema = createInsertSchema(skills).omit({ id: true, createdAt: true });
export type InsertSkill = z.infer<typeof insertSkillSchema>;
export type Skill = typeof skills.$inferSelect;

// User Skills table (junction table)
export const userSkills = pgTable("user_skills", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  skillId: varchar("skill_id").notNull().references(() => skills.id, { onDelete: "cascade" }),
  proficiencyLevel: text("proficiency_level"),
  yearsExperience: integer("years_experience"),
  certifiedAt: timestamp("certified_at"),
  addedAt: timestamp("added_at").notNull().defaultNow(),
});

export const insertUserSkillSchema = createInsertSchema(userSkills).omit({ id: true, addedAt: true });
export type InsertUserSkill = z.infer<typeof insertUserSkillSchema>;
export type UserSkill = typeof userSkills.$inferSelect;

// Equipment table - comprehensive equipment and tool management
export const equipment = pgTable("equipment", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  
  // Multi-tenant isolation
  organizationId: varchar("organization_id").references(() => organizations.id),
  
  // Identification
  name: text("name").notNull(), // Display name: "CAT 320 Excavator #1"
  equipmentCode: text("equipment_code").notNull().unique(), // Internal code: "EQ-001"
  type: text("type").notNull(), // Equipment type (HEAVY_EQUIPMENT, VEHICLE, etc.)
  status: text("status").notNull().default("AVAILABLE"), // AVAILABLE, ASSIGNED, IN_REPAIR, OUT_OF_SERVICE, RETIRED
  
  // Specifications
  make: text("make"), // e.g., "Caterpillar", "DeWalt"
  model: text("model"), // e.g., "320D L", "DW735"
  year: integer("year"),
  serialNumber: text("serial_number"),
  vinNumber: text("vin_number"), // For vehicles
  licensePlate: text("license_plate"), // For road-legal vehicles
  
  // Usage Tracking
  currentHours: decimal("current_hours", { precision: 10, scale: 1 }).default("0"), // Equipment meter hours
  purchaseDate: timestamp("purchase_date"),
  purchasePrice: decimal("purchase_price", { precision: 12, scale: 2 }),
  warrantyExpirationDate: date("warranty_expiration_date"),
  
  // Legacy assignment fields (kept for backwards compatibility)
  assignedToCrewId: varchar("assigned_to_crew_id").references(() => crews.id),
  assignedToProjectId: varchar("assigned_to_project_id").references(() => projects.id),
  
  // Maintenance tracking
  lastMaintenanceDate: timestamp("last_maintenance_date"),
  nextMaintenanceDate: timestamp("next_maintenance_date"),
  
  // Description and Notes
  description: text("description"),
  specifications: text("specifications"), // JSON or detailed specs
  notes: text("notes"),
  
  // Current Location (when not assigned to project)
  homeLocation: text("home_location"), // Default storage location
  currentLocation: text("current_location"), // Current whereabouts
  
  // Image/Documentation
  imageUrl: text("image_url"),
  manualUrl: text("manual_url"),
  
  // Tracking
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  statusIdx: index("equipment_status_idx").on(table.status),
  typeIdx: index("equipment_type_idx").on(table.type),
  codeIdx: index("equipment_code_idx").on(table.equipmentCode),
  organizationIdx: index("equipment_organization_idx").on(table.organizationId),
}));

export const insertEquipmentSchema = createInsertSchema(equipment).omit({ id: true, createdAt: true, updatedAt: true, organizationId: true });
export type InsertEquipment = z.infer<typeof insertEquipmentSchema>;
export type Equipment = typeof equipment.$inferSelect;

// Validated equipment schema with proper coercion for API input
// Handles empty strings from form inputs by converting to null
export const validatedEquipmentSchema = createInsertSchema(equipment).omit({ id: true, createdAt: true, updatedAt: true, organizationId: true }).extend({
  // Coerce year: empty string or invalid → null, valid number → number
  year: z.preprocess(
    (val) => {
      if (val === '' || val === null || val === undefined) return null;
      const parsed = typeof val === 'string' ? parseInt(val, 10) : val;
      return isNaN(parsed as number) ? null : parsed;
    },
    z.number().int().min(1900).max(2100).nullable().optional()
  ),
  // Coerce currentHours: empty string → "0" (default), valid number string → string
  currentHours: z.preprocess(
    (val) => {
      if (val === '' || val === null || val === undefined) return null;
      const parsed = typeof val === 'string' ? parseFloat(val) : val;
      return isNaN(parsed as number) ? null : String(parsed);
    },
    z.string().nullable().optional()
  ),
  // Coerce purchasePrice: empty string or invalid → null, valid number string → string
  purchasePrice: z.preprocess(
    (val) => {
      if (val === '' || val === null || val === undefined) return null;
      const parsed = typeof val === 'string' ? parseFloat(val) : val;
      return isNaN(parsed as number) ? null : String(parsed);
    },
    z.string().nullable().optional()
  ),
});
export type ValidatedInsertEquipment = z.infer<typeof validatedEquipmentSchema>;

// Crew Project Assignments table
export const crewProjectAssignments = pgTable("crew_project_assignments", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  crewId: varchar("crew_id").notNull().references(() => crews.id, { onDelete: "cascade" }),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  startDate: timestamp("start_date"),
  endDate: timestamp("end_date"),
  assignedById: varchar("assigned_by_id").notNull().references(() => users.id),
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertCrewProjectAssignmentSchema = createInsertSchema(crewProjectAssignments).omit({ id: true, createdAt: true });
export type InsertCrewProjectAssignment = z.infer<typeof insertCrewProjectAssignmentSchema>;
export type CrewProjectAssignment = typeof crewProjectAssignments.$inferSelect;

// AI Data Quality table
export const aiDataQuality = pgTable("ai_data_quality", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  overallScore: integer("overall_score").notNull(),
  financialDataScore: integer("financial_data_score").notNull(),
  laborDataScore: integer("labor_data_score").notNull(),
  materialDataScore: integer("material_data_score").notNull(),
  timelineDataScore: integer("timeline_data_score").notNull(),
  scopeDataScore: integer("scope_data_score").notNull(),
  missingFields: text("missing_fields").array(),
  recommendations: text("recommendations").array(),
  calculatedAt: timestamp("calculated_at").notNull().defaultNow(),
});

export const insertAIDataQualitySchema = createInsertSchema(aiDataQuality).omit({ id: true, calculatedAt: true });
export type InsertAIDataQuality = z.infer<typeof insertAIDataQualitySchema>;
export type AIDataQuality = typeof aiDataQuality.$inferSelect;

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
  subcontractorId: varchar("subcontractor_id").notNull().references(() => subcontractors.id, { onDelete: "cascade" }),
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

// ===================
// CRM System Tables
// ===================

// CRM Organisations table - Companies (Contractors, Subcontractors, Suppliers, Vendors)
export const crmOrganisations = pgTable("crm_organisations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").references(() => organizations.id, { onDelete: "cascade" }),
  type: crmOrganisationTypeEnum("type").notNull(),
  name: text("name").notNull(),
  address: text("address"),
  city: text("city"),
  state: text("state"),
  zipCode: text("zip_code"),
  website: text("website"),
  specialties: text("specialties").array(),
  insuranceCarrier: text("insurance_carrier"),
  insurancePolicyNumber: text("insurance_policy_number"),
  insuranceExpiration: timestamp("insurance_expiration"),
  insuranceCoverageAmount: decimal("insurance_coverage_amount", { precision: 12, scale: 2 }),
  wcInsuranceCarrier: text("wc_insurance_carrier"),
  wcInsuranceExpiration: timestamp("wc_insurance_expiration"),
  licenseNumber: text("license_number"),
  licenseExpiration: timestamp("license_expiration"),
  taxId: text("tax_id"),
  paymentTerms: text("payment_terms"),
  notes: text("notes"),
  isActive: boolean("is_active").notNull().default(true),
  legacySubcontractorId: varchar("legacy_subcontractor_id"),
  createdById: varchar("created_by_id").references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  organizationIdx: index("crm_organisations_org_idx").on(table.organizationId),
  typeIdx: index("crm_organisations_type_idx").on(table.type),
  nameIdx: index("crm_organisations_name_idx").on(table.name),
}));

export const insertCrmOrganisationSchema = createInsertSchema(crmOrganisations).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertCrmOrganisation = z.infer<typeof insertCrmOrganisationSchema>;
export type CrmOrganisation = typeof crmOrganisations.$inferSelect;

// CRM Contacts table - People associated with organisations
export const crmContacts = pgTable("crm_contacts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").references(() => organizations.id, { onDelete: "cascade" }),
  organisationId: varchar("organisation_id").notNull().references(() => crmOrganisations.id, { onDelete: "cascade" }),
  firstName: text("first_name").notNull(),
  lastName: text("last_name").notNull(),
  title: text("title"),
  role: crmContactRoleEnum("role").notNull().default("OTHER"),
  email: text("email"),
  phone: text("phone"),
  mobile: text("mobile"),
  preferredContact: crmPreferredContactEnum("preferred_contact").default("EMAIL"),
  preferredContactOther: text("preferred_contact_other"),
  notes: text("notes"),
  isPrimary: boolean("is_primary").notNull().default(false),
  isActive: boolean("is_active").notNull().default(true),
  createdById: varchar("created_by_id").references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  organizationIdx: index("crm_contacts_org_idx").on(table.organizationId),
  organisationIdx: index("crm_contacts_organisation_idx").on(table.organisationId),
}));

export const insertCrmContactSchema = createInsertSchema(crmContacts).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertCrmContact = z.infer<typeof insertCrmContactSchema>;
export type CrmContact = typeof crmContacts.$inferSelect;

// CRM Organisation Notes table - Activity log for tracking interactions
// Auto-timestamps to track when managers contact organizations/people
export const crmOrganisationNotes = pgTable("crm_organisation_notes", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").references(() => organizations.id, { onDelete: "cascade" }),
  organisationId: varchar("organisation_id").notNull().references(() => crmOrganisations.id, { onDelete: "cascade" }),
  contactId: varchar("contact_id").references(() => crmContacts.id, { onDelete: "set null" }), // Optional: link to specific contact
  noteType: crmNoteTypeEnum("note_type").notNull().default("GENERAL"),
  content: text("content").notNull(),
  createdById: varchar("created_by_id").references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  organizationIdx: index("crm_org_notes_org_idx").on(table.organizationId),
  organisationIdx: index("crm_org_notes_organisation_idx").on(table.organisationId),
  createdAtIdx: index("crm_org_notes_created_at_idx").on(table.createdAt),
}));

export const insertCrmOrganisationNoteSchema = createInsertSchema(crmOrganisationNotes).omit({ id: true, createdAt: true });
export type InsertCrmOrganisationNote = z.infer<typeof insertCrmOrganisationNoteSchema>;
export type CrmOrganisationNote = typeof crmOrganisationNotes.$inferSelect;

// Takeoff + Estimating Insert/Select Schemas
export const insertProjectPlanSchema = createInsertSchema(projectPlans).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertProjectPlan = z.infer<typeof insertProjectPlanSchema>;
export type ProjectPlan = typeof projectPlans.$inferSelect;

export const insertQuantityCategorySchema = createInsertSchema(quantityCategories).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertQuantityCategory = z.infer<typeof insertQuantityCategorySchema>;
export type QuantityCategory = typeof quantityCategories.$inferSelect;

export const insertTakeoffSheetSchema = createInsertSchema(takeoffSheets).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertTakeoffSheet = z.infer<typeof insertTakeoffSheetSchema>;
export type TakeoffSheet = typeof takeoffSheets.$inferSelect;

export const insertTakeoffMeasurementSchema = createInsertSchema(takeoffMeasurements).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertTakeoffMeasurement = z.infer<typeof insertTakeoffMeasurementSchema>;
export type TakeoffMeasurement = typeof takeoffMeasurements.$inferSelect;

export const insertProjectSpecSchema = createInsertSchema(projectSpecs).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertProjectSpec = z.infer<typeof insertProjectSpecSchema>;
export type ProjectSpec = typeof projectSpecs.$inferSelect;

export const insertProjectSpecIndexSchema = createInsertSchema(projectSpecIndex).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertProjectSpecIndex = z.infer<typeof insertProjectSpecIndexSchema>;
export type ProjectSpecIndex = typeof projectSpecIndex.$inferSelect;

export const insertEstimateSettingsSchema = createInsertSchema(estimateSettings).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertEstimateSettings = z.infer<typeof insertEstimateSettingsSchema>;
export type EstimateSettings = typeof estimateSettings.$inferSelect;

export const insertEstimateCrewSchema = createInsertSchema(estimateCrews).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertEstimateCrew = z.infer<typeof insertEstimateCrewSchema>;
export type EstimateCrew = typeof estimateCrews.$inferSelect;

export const insertEstimateLineItemSchema = createInsertSchema(estimateLineItems).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertEstimateLineItem = z.infer<typeof insertEstimateLineItemSchema>;
export type EstimateLineItem = typeof estimateLineItems.$inferSelect;

export const insertEstimateVersionSchema = createInsertSchema(estimateVersions).omit({ id: true, createdAt: true });
export type InsertEstimateVersion = z.infer<typeof insertEstimateVersionSchema>;
export type EstimateVersion = typeof estimateVersions.$inferSelect;

export const insertEstimateVendorQuoteSchema = createInsertSchema(estimateVendorQuotes).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertEstimateVendorQuote = z.infer<typeof insertEstimateVendorQuoteSchema>;
export type EstimateVendorQuote = typeof estimateVendorQuotes.$inferSelect;

export const insertEstimateHistorySchema = createInsertSchema(estimateHistory).omit({ id: true, createdAt: true });
export type InsertEstimateHistory = z.infer<typeof insertEstimateHistorySchema>;
export type EstimateHistory = typeof estimateHistory.$inferSelect;

// Estimator Handoff Packet table - Job Information for QuickBooks setup
// Links to either a bid (during bidding) or project (after award)
export const handoffPackets = pgTable("handoff_packets", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  bidId: varchar("bid_id").references(() => bids.id, { onDelete: "cascade" }),
  projectId: varchar("project_id").references(() => projects.id, { onDelete: "cascade" }),
  
  // 1. Job Overview
  gcName: text("gc_name"),
  gcContactName: text("gc_contact_name"),
  gcPhone: text("gc_phone"),
  gcEmail: text("gc_email"),
  accessDetails: text("access_details"),
  scopeOfWorkSummary: text("scope_of_work_summary"),
  
  // 2. Estimate Snapshot
  contractValue: decimal("contract_value", { precision: 12, scale: 2 }),
  bidDate: date("bid_date"),
  awardDate: date("award_date"),
  markupPercent: decimal("markup_percent", { precision: 5, scale: 2 }),
  duration: text("duration"),
  projectStartDate: date("project_start_date"),
  projectCompletionDate: date("project_completion_date"),
  manpower: text("manpower"),
  alternates: text("alternates"),
  
  // 3. Contract & Documentation
  subcontractExecuted: boolean("subcontract_executed"),
  insuranceCerts: text("insurance_certs"),
  bondRequired: boolean("bond_required"),
  permits: text("permits"),
  retentionPercent: decimal("retention_percent", { precision: 5, scale: 2 }),
  paymentTerms: text("payment_terms"),
  scheduleOfValuesReady: boolean("schedule_of_values_ready"),
  drawSchedule: text("draw_schedule"),
  prevailingWage: boolean("prevailing_wage"),
  
  // 4. Materials & Supply Chain Plan
  concreteSupplier: text("concrete_supplier"),
  mixInfo: text("mix_info"),
  rebarVendor: text("rebar_vendor"),
  formingMaterialPlan: text("forming_material_plan"),
  curingSpecs: text("curing_specs"),
  specialItems: text("special_items"),
  leadTimeRisks: text("lead_time_risks"),
  submittalStatus: text("submittal_status"),
  
  // 5. Field Work Details
  layoutSurveyBy: text("layout_survey_by"),
  benchmarkInfo: text("benchmark_info"),
  accessZones: text("access_zones"),
  workHours: text("work_hours"),
  safetyOrientation: text("safety_orientation"),
  inspectionNeeds: text("inspection_needs"),
  
  // 6. Project Notes & Risk Items
  coordinationIssues: text("coordination_issues"),
  weatherRisks: text("weather_risks"),
  soilConditions: text("soil_conditions"),
  estimatorNotes: text("estimator_notes"),
  
  // 7. Communication Protocol
  gcContactMethod: text("gc_contact_method"),
  projectManager: text("project_manager"),
  superintendent: text("superintendent"),
  officeAdmin: text("office_admin"),
  safetyContact: text("safety_contact"),
  
  createdById: varchar("created_by_id").references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertHandoffPacketSchema = createInsertSchema(handoffPackets).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertHandoffPacket = z.infer<typeof insertHandoffPacketSchema>;
export type HandoffPacket = typeof handoffPackets.$inferSelect;

// ============================================================
// STANDARDIZED SCOPE OF WORK SYSTEM
// Admin-editable work types and modifiers for consistent AI tracking
// ============================================================

// Scope Work Type Categories (grouping similar work types)
export const scopeWorkTypeCategories = pgTable("scope_work_type_categories", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull().unique(), // e.g., "Sidewalk", "Driveway", "Curb & Gutter"
  displayOrder: integer("display_order").notNull().default(0),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Scope Work Types (admin-editable, used in dropdowns)
export const scopeWorkTypes = pgTable("scope_work_types", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  categoryId: varchar("category_id").notNull().references(() => scopeWorkTypeCategories.id, { onDelete: "cascade" }),
  name: text("name").notNull(), // e.g., "4\" Sidewalk", "6\" Driveway"
  code: text("code").notNull().unique(), // Machine-readable code for AI grouping: "sidewalk_4in"
  requiresDimensions: boolean("requires_dimensions").notNull().default(false), // For footings/foundations
  dimensionLabel: text("dimension_label"), // e.g., "L x W x D" or "L x H x Thickness"
  displayOrder: integer("display_order").notNull().default(0),
  isActive: boolean("is_active").notNull().default(true),
  isCustom: boolean("is_custom").notNull().default(false), // Admin-added custom types
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  categoryIdx: index("scope_work_types_category_idx").on(table.categoryId),
}));

// Scope Modifier Categories (grouping similar modifiers)
export const scopeModifierCategories = pgTable("scope_modifier_categories", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull().unique(), // e.g., "Reinforcement", "Mix Type", "Finish Type"
  displayOrder: integer("display_order").notNull().default(0),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Scope Modifiers (admin-editable, used in multi-select)
export const scopeModifiers = pgTable("scope_modifiers", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  categoryId: varchar("category_id").notNull().references(() => scopeModifierCategories.id, { onDelete: "cascade" }),
  name: text("name").notNull(), // e.g., "Rebar (#4)", "High Early", "Broom Finish"
  code: text("code").notNull().unique(), // Machine-readable: "rebar_4", "mix_high_early"
  displayOrder: integer("display_order").notNull().default(0),
  isActive: boolean("is_active").notNull().default(true),
  isCustom: boolean("is_custom").notNull().default(false), // Admin-added custom modifiers
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  categoryIdx: index("scope_modifiers_category_idx").on(table.categoryId),
}));

// Insert/Select Schemas for Scope System
export const insertScopeWorkTypeCategorySchema = createInsertSchema(scopeWorkTypeCategories).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertScopeWorkTypeCategory = z.infer<typeof insertScopeWorkTypeCategorySchema>;
export type ScopeWorkTypeCategory = typeof scopeWorkTypeCategories.$inferSelect;

export const insertScopeWorkTypeSchema = createInsertSchema(scopeWorkTypes).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertScopeWorkType = z.infer<typeof insertScopeWorkTypeSchema>;
export type ScopeWorkType = typeof scopeWorkTypes.$inferSelect;

export const insertScopeModifierCategorySchema = createInsertSchema(scopeModifierCategories).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertScopeModifierCategory = z.infer<typeof insertScopeModifierCategorySchema>;
export type ScopeModifierCategory = typeof scopeModifierCategories.$inferSelect;

export const insertScopeModifierSchema = createInsertSchema(scopeModifiers).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertScopeModifier = z.infer<typeof insertScopeModifierSchema>;
export type ScopeModifier = typeof scopeModifiers.$inferSelect;

// ============================================================
// MATERIAL CALCULATOR PRESETS
// Saved dimension configurations for work types
// ============================================================

// Material Calculator Presets - stores saved dimension configurations
export const materialCalculatorPresets = pgTable("material_calculator_presets", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  name: text("name").notNull(), // e.g., "Standard Curb 6x18", "Heavy Duty Sidewalk"
  workTypeCode: text("work_type_code"), // Optional link to specific work type code
  unit: text("unit").notNull(), // LF, SF, etc.
  
  // Concrete dimensions
  concreteDepthInches: decimal("concrete_depth_inches", { precision: 6, scale: 2 }),
  dimensionWidthInches: decimal("dimension_width_inches", { precision: 6, scale: 2 }),
  dimensionHeightInches: decimal("dimension_height_inches", { precision: 6, scale: 2 }),
  concreteWasteFactor: decimal("concrete_waste_factor", { precision: 5, scale: 2 }).default("10"),
  
  // Stone sub-base
  requiresStoneBase: boolean("requires_stone_base").default(false),
  stoneType: text("stone_type"),
  stoneSize: text("stone_size"), // Stone gradation: #304, #1, #2, #4, #57, #67, #8, etc.
  stoneDepthInches: decimal("stone_depth_inches", { precision: 6, scale: 2 }),
  stoneWasteFactor: decimal("stone_waste_factor", { precision: 5, scale: 2 }).default("10"),
  
  // Excavation
  requiresExcavation: boolean("requires_excavation").default(false),
  excavationDepthInches: decimal("excavation_depth_inches", { precision: 6, scale: 2 }),
  excavationWidthInches: decimal("excavation_width_inches", { precision: 6, scale: 2 }),
  excavationSwellFactor: decimal("excavation_swell_factor", { precision: 5, scale: 2 }).default("25"),
  
  // Wire mesh
  requiresWireMesh: boolean("requires_wire_mesh").default(false),
  wireMeshType: text("wire_mesh_type"),
  wireMeshWasteFactor: decimal("wire_mesh_waste_factor", { precision: 5, scale: 2 }).default("10"),
  
  // Rebar
  requiresRebar: boolean("requires_rebar").default(false),
  rebarSize: text("rebar_size"),
  rebarFabType: text("rebar_fab_type"), // Fabrication type: FIELD_TIED, PREFAB_MAT, PREFAB_CAGE, FIBER_MESH
  rebarSpacingInches: decimal("rebar_spacing_inches", { precision: 6, scale: 2 }),
  rebarWasteFactor: decimal("rebar_waste_factor", { precision: 5, scale: 2 }).default("10"),
  
  // Sealer
  requiresSealer: boolean("requires_sealer").default(false),
  sealerType: text("sealer_type"),
  sealerCoats: integer("sealer_coats").default(1),
  sealerWasteFactor: decimal("sealer_waste_factor", { precision: 5, scale: 2 }).default("10"),
  
  // Underlayment
  requiresUnderlayment: boolean("requires_underlayment").default(false),
  underlaymentType: text("underlayment_type"),
  underlaymentOverlapInches: decimal("underlayment_overlap_inches", { precision: 6, scale: 2 }),
  underlaymentWasteFactor: decimal("underlayment_waste_factor", { precision: 5, scale: 2 }).default("10"),
  
  // Metadata
  isDefault: boolean("is_default").default(false), // Mark as default preset for this work type
  createdById: varchar("created_by_id").references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  orgIdx: index("material_calc_presets_org_idx").on(table.organizationId),
  workTypeIdx: index("material_calc_presets_work_type_idx").on(table.workTypeCode),
}));

export const insertMaterialCalculatorPresetSchema = createInsertSchema(materialCalculatorPresets).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertMaterialCalculatorPreset = z.infer<typeof insertMaterialCalculatorPresetSchema>;
export type MaterialCalculatorPreset = typeof materialCalculatorPresets.$inferSelect;

// ============================================================
// MASTER MODIFIERS BY TRADE (Template Library)
// Trade-specific modifiers for scope standardization
// ============================================================

// Master Modifier Categories by Trade
export const masterModifierCategories = pgTable("master_modifier_categories", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tradeType: tradeTypeEnum("trade_type").notNull(),
  name: text("name").notNull(),
  description: text("description"),
  displayOrder: integer("display_order").notNull().default(0),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  tradeIdx: index("master_mod_cat_trade_idx").on(table.tradeType),
  nameTradeUnique: unique("master_mod_cat_name_trade_unique").on(table.tradeType, table.name),
}));

// Master Modifiers by Trade
export const masterModifiers = pgTable("master_modifiers", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tradeType: tradeTypeEnum("trade_type").notNull(),
  categoryId: varchar("category_id").notNull().references(() => masterModifierCategories.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  code: text("code").notNull(),
  description: text("description"),
  displayOrder: integer("display_order").notNull().default(0),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  tradeIdx: index("master_mod_trade_idx").on(table.tradeType),
  categoryIdx: index("master_mod_category_idx").on(table.categoryId),
  codeTradeUnique: unique("master_mod_code_trade_unique").on(table.tradeType, table.code),
}));

export const insertMasterModifierCategorySchema = createInsertSchema(masterModifierCategories).omit({ id: true, createdAt: true });
export type InsertMasterModifierCategory = z.infer<typeof insertMasterModifierCategorySchema>;
export type MasterModifierCategory = typeof masterModifierCategories.$inferSelect;

export const insertMasterModifierSchema = createInsertSchema(masterModifiers).omit({ id: true, createdAt: true });
export type InsertMasterModifier = z.infer<typeof insertMasterModifierSchema>;
export type MasterModifier = typeof masterModifiers.$inferSelect;

// ============================================================
// INTERNAL MESSAGING SYSTEM
// Company-wide chat, group channels, and direct messages
// ============================================================

// Conversations table (channels and direct messages)
export const conversations = pgTable("conversations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").references(() => organizations.id, { onDelete: "cascade" }),
  type: conversationTypeEnum("type").notNull(), // DIRECT, GROUP, COMPANY
  name: text("name"), // null for direct messages, required for groups/company
  description: text("description"),
  isCompanyChannel: boolean("is_company_channel").notNull().default(false), // The main company-wide channel
  createdById: varchar("created_by_id").notNull().references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  typeIdx: index("conversations_type_idx").on(table.type),
  orgIdx: index("conversations_org_idx").on(table.organizationId),
}));

// Conversation Participants table
export const conversationParticipants = pgTable("conversation_participants", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  conversationId: varchar("conversation_id").notNull().references(() => conversations.id, { onDelete: "cascade" }),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  joinedAt: timestamp("joined_at").notNull().defaultNow(),
  lastReadAt: timestamp("last_read_at"),
  isAdmin: boolean("is_admin").notNull().default(false), // For group channels
}, (table) => ({
  conversationUserIdx: index("conversation_participants_conv_user_idx").on(table.conversationId, table.userId),
  userIdx: index("conversation_participants_user_idx").on(table.userId),
  uniqueParticipant: unique("conversation_participants_unique").on(table.conversationId, table.userId),
}));

// Messages table
export const messages = pgTable("messages", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  conversationId: varchar("conversation_id").notNull().references(() => conversations.id, { onDelete: "cascade" }),
  senderId: varchar("sender_id").notNull().references(() => users.id),
  content: text("content").notNull(),
  attachmentUrl: text("attachment_url"),
  attachmentName: text("attachment_name"),
  attachmentType: text("attachment_type"),
  isEdited: boolean("is_edited").notNull().default(false),
  editedAt: timestamp("edited_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  conversationIdx: index("messages_conversation_idx").on(table.conversationId),
  senderIdx: index("messages_sender_idx").on(table.senderId),
  createdAtIdx: index("messages_created_at_idx").on(table.createdAt),
}));

// Message Read Receipts (for tracking who's read each message)
export const messageReadReceipts = pgTable("message_read_receipts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  messageId: varchar("message_id").notNull().references(() => messages.id, { onDelete: "cascade" }),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  readAt: timestamp("read_at").notNull().defaultNow(),
}, (table) => ({
  messageUserIdx: unique("message_read_receipts_unique").on(table.messageId, table.userId),
}));

// Insert/Select Schemas for Messaging System
export const insertConversationSchema = createInsertSchema(conversations).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertConversation = z.infer<typeof insertConversationSchema>;
export type Conversation = typeof conversations.$inferSelect;

export const insertConversationParticipantSchema = createInsertSchema(conversationParticipants).omit({ id: true, joinedAt: true });
export type InsertConversationParticipant = z.infer<typeof insertConversationParticipantSchema>;
export type ConversationParticipant = typeof conversationParticipants.$inferSelect;

export const insertMessageSchema = createInsertSchema(messages).omit({ id: true, createdAt: true });
export type InsertMessage = z.infer<typeof insertMessageSchema>;
export type Message = typeof messages.$inferSelect;

export const insertMessageReadReceiptSchema = createInsertSchema(messageReadReceipts).omit({ id: true, readAt: true });
export type InsertMessageReadReceipt = z.infer<typeof insertMessageReadReceiptSchema>;
export type MessageReadReceipt = typeof messageReadReceipts.$inferSelect;

// ============================================================
// EQUIPMENT & TOOL MANAGEMENT SYSTEM
// Comprehensive tracking for construction equipment and tools
// ============================================================

// Equipment Status Enum
export const equipmentStatusEnum = pgEnum("equipment_status", [
  "AVAILABLE",      // Ready for assignment
  "ASSIGNED",       // Currently on a job
  "IN_REPAIR",      // Being repaired
  "OUT_OF_SERVICE", // Temporarily unavailable
  "RETIRED"         // No longer in use
]);

// Equipment Type Enum
export const equipmentTypeEnum = pgEnum("equipment_type", [
  "HEAVY_EQUIPMENT",  // Excavators, loaders, dozers
  "POWER_TOOL",       // Drills, saws, grinders
  "HAND_TOOL",        // Hammers, wrenches, etc.
  "VEHICLE",          // Trucks, vans
  "TRAILER",          // Flatbeds, enclosed trailers
  "CONCRETE",         // Mixers, vibrators, screeds
  "COMPACTION",       // Rollers, plate compactors
  "SURVEYING",        // Levels, total stations
  "SAFETY",           // Safety equipment
  "OTHER"
]);

// Repair Status Enum
export const repairStatusEnum = pgEnum("repair_status", [
  "PENDING",      // Waiting to be started
  "IN_PROGRESS",  // Currently being repaired
  "COMPLETED",    // Repair finished
  "CANCELLED"     // Repair cancelled
]);

// Maintenance Type Enum
export const maintenanceTypeEnum = pgEnum("maintenance_type", [
  "PREVENTATIVE",      // Scheduled PM (oil changes, filters, etc.)
  "SCHEDULED_SERVICE", // Major service intervals
  "WEAR_ITEM",         // Tracks, tires, blades, etc.
  "INSPECTION",        // Safety inspections
  "CALIBRATION"        // For precision equipment
]);

// Equipment Assignments (link equipment to projects)
export const equipmentAssignments = pgTable("equipment_assignments", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  equipmentId: varchar("equipment_id").notNull().references(() => equipment.id, { onDelete: "cascade" }),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  
  // Assignment Details
  assignedById: varchar("assigned_by_id").notNull().references(() => users.id),
  assignedAt: timestamp("assigned_at").notNull().defaultNow(),
  expectedReturnDate: date("expected_return_date"),
  
  // Return Details
  returnedAt: timestamp("returned_at"),
  returnedById: varchar("returned_by_id").references(() => users.id),
  returnCondition: text("return_condition"),
  hoursAtAssignment: decimal("hours_at_assignment", { precision: 10, scale: 1 }),
  hoursAtReturn: decimal("hours_at_return", { precision: 10, scale: 1 }),
  
  notes: text("notes"),
  isActive: boolean("is_active").notNull().default(true), // false when returned
  
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  equipmentIdx: index("equipment_assignments_equipment_idx").on(table.equipmentId),
  projectIdx: index("equipment_assignments_project_idx").on(table.projectId),
  activeIdx: index("equipment_assignments_active_idx").on(table.isActive),
}));

// Equipment Repairs
export const equipmentRepairs = pgTable("equipment_repairs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  equipmentId: varchar("equipment_id").notNull().references(() => equipment.id, { onDelete: "cascade" }),
  
  // Repair Details
  repairNumber: text("repair_number").notNull(), // e.g., "REP-001"
  description: text("description").notNull(),
  status: repairStatusEnum("status").notNull().default("PENDING"),
  
  // Problem Info
  problemReportedAt: timestamp("problem_reported_at").notNull().defaultNow(),
  problemReportedById: varchar("problem_reported_by_id").notNull().references(() => users.id),
  problemDescription: text("problem_description"),
  hoursAtReport: decimal("hours_at_report", { precision: 10, scale: 1 }),
  
  // Repair Location
  repairLocation: text("repair_location"), // "In-house", "ABC Equipment", etc.
  repairVendorId: varchar("repair_vendor_id"), // Link to CRM organization if external
  
  // Costs
  estimatedCost: decimal("estimated_cost", { precision: 12, scale: 2 }),
  actualCost: decimal("actual_cost", { precision: 12, scale: 2 }),
  laborCost: decimal("labor_cost", { precision: 12, scale: 2 }),
  partsCost: decimal("parts_cost", { precision: 12, scale: 2 }),
  
  // Timeline
  estimatedCompletionDate: date("estimated_completion_date"),
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
  completedById: varchar("completed_by_id").references(() => users.id),
  
  // Resolution
  repairNotes: text("repair_notes"),
  partsUsed: text("parts_used"), // JSON array of parts
  
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  equipmentIdx: index("equipment_repairs_equipment_idx").on(table.equipmentId),
  statusIdx: index("equipment_repairs_status_idx").on(table.status),
}));

// Equipment Maintenance Schedules (PM schedules)
export const equipmentMaintenanceSchedules = pgTable("equipment_maintenance_schedules", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  equipmentId: varchar("equipment_id").notNull().references(() => equipment.id, { onDelete: "cascade" }),
  
  // Schedule Details
  maintenanceType: maintenanceTypeEnum("maintenance_type").notNull(),
  name: text("name").notNull(), // e.g., "Oil Change", "Annual Inspection"
  description: text("description"),
  
  // Interval (can be hours-based OR calendar-based OR both)
  intervalHours: integer("interval_hours"), // e.g., 250 hours
  intervalDays: integer("interval_days"), // e.g., 90 days (quarterly)
  
  // Tracking
  lastPerformedAt: timestamp("last_performed_at"),
  lastPerformedHours: decimal("last_performed_hours", { precision: 10, scale: 1 }),
  nextDueAt: timestamp("next_due_at"), // Calculated based on interval
  nextDueHours: decimal("next_due_hours", { precision: 10, scale: 1 }), // Calculated based on hours
  
  // Alert Settings
  alertDaysBefore: integer("alert_days_before").default(7), // Days before due to alert
  alertHoursBefore: integer("alert_hours_before").default(25), // Hours before due to alert
  
  isActive: boolean("is_active").notNull().default(true),
  
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  equipmentIdx: index("equipment_maintenance_equipment_idx").on(table.equipmentId),
  nextDueIdx: index("equipment_maintenance_next_due_idx").on(table.nextDueAt),
}));

// Equipment Maintenance History (completed maintenance records)
export const equipmentMaintenanceHistory = pgTable("equipment_maintenance_history", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  equipmentId: varchar("equipment_id").notNull().references(() => equipment.id, { onDelete: "cascade" }),
  scheduleId: varchar("schedule_id").references(() => equipmentMaintenanceSchedules.id, { onDelete: "set null" }),
  
  // Maintenance Details
  maintenanceType: maintenanceTypeEnum("maintenance_type").notNull(),
  description: text("description").notNull(),
  performedAt: timestamp("performed_at").notNull(),
  hoursAtMaintenance: decimal("hours_at_maintenance", { precision: 10, scale: 1 }),
  
  // Who performed it
  performedById: varchar("performed_by_id").references(() => users.id),
  performedByVendor: text("performed_by_vendor"), // If external
  
  // Costs
  laborCost: decimal("labor_cost", { precision: 12, scale: 2 }),
  partsCost: decimal("parts_cost", { precision: 12, scale: 2 }),
  totalCost: decimal("total_cost", { precision: 12, scale: 2 }),
  
  notes: text("notes"),
  partsUsed: text("parts_used"), // JSON array
  
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  equipmentIdx: index("equipment_maintenance_history_equipment_idx").on(table.equipmentId),
  performedAtIdx: index("equipment_maintenance_history_performed_idx").on(table.performedAt),
}));

// Equipment Hour Logs (weekly hour entries for machines on jobs)
export const equipmentHourLogs = pgTable("equipment_hour_logs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  equipmentId: varchar("equipment_id").notNull().references(() => equipment.id, { onDelete: "cascade" }),
  assignmentId: varchar("assignment_id").references(() => equipmentAssignments.id, { onDelete: "set null" }),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  
  // Week/Period
  weekStartDate: date("week_start_date").notNull(), // Monday of the week
  weekEndDate: date("week_end_date").notNull(), // Sunday of the week
  
  // Hours
  startingHours: decimal("starting_hours", { precision: 10, scale: 1 }).notNull(),
  endingHours: decimal("ending_hours", { precision: 10, scale: 1 }).notNull(),
  hoursUsed: decimal("hours_used", { precision: 10, scale: 1 }).notNull(), // Calculated: ending - starting
  
  // Submitted by
  submittedById: varchar("submitted_by_id").notNull().references(() => users.id),
  submittedAt: timestamp("submitted_at").notNull().defaultNow(),
  
  notes: text("notes"),
  fuelUsed: decimal("fuel_used", { precision: 10, scale: 2 }), // Gallons
  
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  equipmentIdx: index("equipment_hour_logs_equipment_idx").on(table.equipmentId),
  projectIdx: index("equipment_hour_logs_project_idx").on(table.projectId),
  weekIdx: index("equipment_hour_logs_week_idx").on(table.weekStartDate),
  uniqueWeekEntry: unique("equipment_hour_logs_unique_week").on(table.equipmentId, table.weekStartDate),
}));

// Equipment Hour Entry Reminders (track which managers need to submit hours)
export const equipmentHourReminders = pgTable("equipment_hour_reminders", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  equipmentId: varchar("equipment_id").notNull().references(() => equipment.id, { onDelete: "cascade" }),
  assignmentId: varchar("assignment_id").notNull().references(() => equipmentAssignments.id, { onDelete: "cascade" }),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  managerId: varchar("manager_id").notNull().references(() => users.id), // Project manager to remind
  
  weekStartDate: date("week_start_date").notNull(),
  reminderSentAt: timestamp("reminder_sent_at"),
  isCompleted: boolean("is_completed").notNull().default(false),
  completedAt: timestamp("completed_at"),
  
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  managerIdx: index("equipment_hour_reminders_manager_idx").on(table.managerId),
  weekIdx: index("equipment_hour_reminders_week_idx").on(table.weekStartDate),
}));

// Insert/Select Schemas for Equipment System
export const insertEquipmentAssignmentSchema = createInsertSchema(equipmentAssignments).omit({ id: true, createdAt: true, updatedAt: true, assignedAt: true });
export type InsertEquipmentAssignment = z.infer<typeof insertEquipmentAssignmentSchema>;
export type EquipmentAssignment = typeof equipmentAssignments.$inferSelect;

export const insertEquipmentRepairSchema = createInsertSchema(equipmentRepairs).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertEquipmentRepair = z.infer<typeof insertEquipmentRepairSchema>;
export type EquipmentRepair = typeof equipmentRepairs.$inferSelect;

export const insertEquipmentMaintenanceScheduleSchema = createInsertSchema(equipmentMaintenanceSchedules).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertEquipmentMaintenanceSchedule = z.infer<typeof insertEquipmentMaintenanceScheduleSchema>;
export type EquipmentMaintenanceSchedule = typeof equipmentMaintenanceSchedules.$inferSelect;

export const insertEquipmentMaintenanceHistorySchema = createInsertSchema(equipmentMaintenanceHistory).omit({ id: true, createdAt: true });
export type InsertEquipmentMaintenanceHistory = z.infer<typeof insertEquipmentMaintenanceHistorySchema>;
export type EquipmentMaintenanceHistory = typeof equipmentMaintenanceHistory.$inferSelect;

export const insertEquipmentHourLogSchema = createInsertSchema(equipmentHourLogs).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertEquipmentHourLog = z.infer<typeof insertEquipmentHourLogSchema>;
export type EquipmentHourLog = typeof equipmentHourLogs.$inferSelect;

export const insertEquipmentHourReminderSchema = createInsertSchema(equipmentHourReminders).omit({ id: true, createdAt: true });
export type InsertEquipmentHourReminder = z.infer<typeof insertEquipmentHourReminderSchema>;
export type EquipmentHourReminder = typeof equipmentHourReminders.$inferSelect;

// ============================================
// EQUIPMENT RATES, RENTALS & BID/PROJECT INTEGRATION
// ============================================

// Equipment Rate Profiles - Internal rates for owned equipment
export const equipmentRateProfiles = pgTable("equipment_rate_profiles", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  equipmentId: varchar("equipment_id").notNull().references(() => equipment.id, { onDelete: "cascade" }),
  
  // Rate Structure
  hourlyRate: decimal("hourly_rate", { precision: 10, scale: 2 }).notNull(), // Internal charge per hour
  dailyRate: decimal("daily_rate", { precision: 10, scale: 2 }), // Optional daily rate (8 hours default)
  weeklyRate: decimal("weekly_rate", { precision: 10, scale: 2 }), // Optional weekly rate
  monthlyRate: decimal("monthly_rate", { precision: 10, scale: 2 }), // Optional monthly rate
  
  // Overhead & Burden
  fuelCostPerHour: decimal("fuel_cost_per_hour", { precision: 10, scale: 2 }), // Estimated fuel cost
  maintenanceCostPerHour: decimal("maintenance_cost_per_hour", { precision: 10, scale: 2 }), // Avg maintenance allocation
  operatorCostPerHour: decimal("operator_cost_per_hour", { precision: 10, scale: 2 }), // If operator included
  includesOperator: boolean("includes_operator").notNull().default(false),
  
  // Validity
  effectiveDate: timestamp("effective_date").notNull().defaultNow(),
  expirationDate: timestamp("expiration_date"), // Null = currently active
  isActive: boolean("is_active").notNull().default(true),
  
  notes: text("notes"),
  createdById: varchar("created_by_id").references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  equipmentIdx: index("equipment_rate_profiles_equipment_idx").on(table.equipmentId),
  activeIdx: index("equipment_rate_profiles_active_idx").on(table.isActive),
}));

export const insertEquipmentRateProfileSchema = createInsertSchema(equipmentRateProfiles).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertEquipmentRateProfile = z.infer<typeof insertEquipmentRateProfileSchema>;
export type EquipmentRateProfile = typeof equipmentRateProfiles.$inferSelect;

// Rental Vendors - Track rental companies
export const rentalVendors = pgTable("rental_vendors", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  code: text("code").notNull(), // Short code: "CAT-RENTAL", "SUNBELT" - unique per org
  
  // Multi-tenant isolation
  organizationId: varchar("organization_id").notNull().default("tfr-default-org"),
  
  // Contact Info
  contactName: text("contact_name"),
  contactEmail: text("contact_email"),
  contactPhone: text("contact_phone"),
  address: text("address"),
  city: text("city"),
  state: text("state"),
  
  // Relationship
  accountNumber: text("account_number"), // Our account with them
  paymentTerms: text("payment_terms"), // NET30, etc.
  notes: text("notes"),
  
  // CRM Link (optional)
  crmOrganisationId: varchar("crm_organisation_id").references(() => crmOrganisations.id, { onDelete: "set null" }),
  
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => [
  index("rental_vendors_org_idx").on(table.organizationId),
]);

export const insertRentalVendorSchema = createInsertSchema(rentalVendors).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertRentalVendor = z.infer<typeof insertRentalVendorSchema>;
export type RentalVendor = typeof rentalVendors.$inferSelect;

// Rental Equipment Catalog - Available rental equipment types from vendors
export const rentalEquipmentCatalog = pgTable("rental_equipment_catalog", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  vendorId: varchar("vendor_id").references(() => rentalVendors.id, { onDelete: "cascade" }),
  crmOrganisationId: varchar("crm_organisation_id").references(() => crmOrganisations.id, { onDelete: "cascade" }),
  
  // Equipment Details
  name: text("name").notNull(), // "CAT 320 Excavator"
  equipmentType: text("equipment_type").notNull(), // Maps to equipmentTypeEnum values
  make: text("make"),
  model: text("model"),
  description: text("description"),
  
  // Rental Rates
  hourlyRate: decimal("hourly_rate", { precision: 10, scale: 2 }),
  dailyRate: decimal("daily_rate", { precision: 10, scale: 2 }),
  weeklyRate: decimal("weekly_rate", { precision: 10, scale: 2 }),
  monthlyRate: decimal("monthly_rate", { precision: 10, scale: 2 }),
  
  // Additional Costs
  deliveryFee: decimal("delivery_fee", { precision: 10, scale: 2 }),
  pickupFee: decimal("pickup_fee", { precision: 10, scale: 2 }),
  fuelSurcharge: decimal("fuel_surcharge", { precision: 5, scale: 2 }), // Percentage
  insurancePerDay: decimal("insurance_per_day", { precision: 10, scale: 2 }),
  
  // Availability
  minimumRentalDays: integer("minimum_rental_days").default(1),
  leadTimeDays: integer("lead_time_days").default(1), // Days notice needed
  
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  vendorIdx: index("rental_equipment_catalog_vendor_idx").on(table.vendorId),
  crmOrgIdx: index("rental_equipment_catalog_crm_org_idx").on(table.crmOrganisationId),
  typeIdx: index("rental_equipment_catalog_type_idx").on(table.equipmentType),
}));

export const insertRentalEquipmentCatalogSchema = createInsertSchema(rentalEquipmentCatalog).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertRentalEquipmentCatalog = z.infer<typeof insertRentalEquipmentCatalogSchema>;
export type RentalEquipmentCatalog = typeof rentalEquipmentCatalog.$inferSelect;

// Bid Equipment Selection Source Enum
export const bidEquipmentSourceEnum = pgEnum("bid_equipment_source", [
  "OWNED",   // Company-owned equipment
  "RENTAL"  // Rental from vendor
]);

// Bid Equipment Selections - Equipment planned for bids
export const bidEquipmentSelections = pgTable("bid_equipment_selections", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  bidId: varchar("bid_id").notNull().references(() => bids.id, { onDelete: "cascade" }),
  
  // Equipment Source
  source: bidEquipmentSourceEnum("source").notNull(),
  
  // For OWNED equipment
  equipmentId: varchar("equipment_id").references(() => equipment.id, { onDelete: "set null" }),
  
  // For RENTAL equipment
  rentalCatalogId: varchar("rental_catalog_id").references(() => rentalEquipmentCatalog.id, { onDelete: "set null" }),
  rentalVendorId: varchar("rental_vendor_id").references(() => rentalVendors.id, { onDelete: "set null" }),
  
  // Common Details (for display/costing even if equipment deleted)
  equipmentName: text("equipment_name").notNull(),
  equipmentType: text("equipment_type").notNull(),
  
  // Planned Usage
  plannedHours: decimal("planned_hours", { precision: 10, scale: 1 }),
  plannedDays: integer("planned_days"),
  startDate: timestamp("start_date"),
  endDate: timestamp("end_date"),
  
  // Rate Snapshot (captured at selection time)
  hourlyRate: decimal("hourly_rate", { precision: 10, scale: 2 }),
  dailyRate: decimal("daily_rate", { precision: 10, scale: 2 }),
  weeklyRate: decimal("weekly_rate", { precision: 10, scale: 2 }),
  
  // Calculated Costs
  estimatedCost: decimal("estimated_cost", { precision: 12, scale: 2 }),
  deliveryFee: decimal("delivery_fee", { precision: 10, scale: 2 }),
  
  notes: text("notes"),
  createdById: varchar("created_by_id").references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  bidIdx: index("bid_equipment_selections_bid_idx").on(table.bidId),
  equipmentIdx: index("bid_equipment_selections_equipment_idx").on(table.equipmentId),
  sourceIdx: index("bid_equipment_selections_source_idx").on(table.source),
}));

export const insertBidEquipmentSelectionSchema = createInsertSchema(bidEquipmentSelections).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertBidEquipmentSelection = z.infer<typeof insertBidEquipmentSelectionSchema>;
export type BidEquipmentSelection = typeof bidEquipmentSelections.$inferSelect;

// Project Equipment Plan Status Enum
export const projectEquipmentPlanStatusEnum = pgEnum("project_equipment_plan_status", [
  "PLANNED",           // From bid, not yet assigned
  "ASSIGNED",          // Owned equipment assigned to project
  "RENTAL_BOOKED",     // Rental confirmed with vendor
  "RENTAL_ACTIVE",     // Rental in progress
  "COMPLETED",         // Equipment work finished
  "CANCELLED"          // No longer needed
]);

// Project Equipment Plans - Carryover from bid with planned vs actual tracking
export const projectEquipmentPlans = pgTable("project_equipment_plans", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  
  // Source tracking
  bidEquipmentSelectionId: varchar("bid_equipment_selection_id").references(() => bidEquipmentSelections.id, { onDelete: "set null" }),
  source: bidEquipmentSourceEnum("source").notNull(),
  status: projectEquipmentPlanStatusEnum("status").notNull().default("PLANNED"),
  
  // For OWNED equipment - links to actual assignment
  equipmentId: varchar("equipment_id").references(() => equipment.id, { onDelete: "set null" }),
  assignmentId: varchar("assignment_id").references(() => equipmentAssignments.id, { onDelete: "set null" }),
  
  // For RENTAL equipment
  rentalCatalogId: varchar("rental_catalog_id").references(() => rentalEquipmentCatalog.id, { onDelete: "set null" }),
  rentalVendorId: varchar("rental_vendor_id").references(() => rentalVendors.id, { onDelete: "set null" }),
  rentalConfirmationNumber: text("rental_confirmation_number"),
  
  // Common Details
  equipmentName: text("equipment_name").notNull(),
  equipmentType: text("equipment_type").notNull(),
  
  // Planned (from bid)
  plannedHours: decimal("planned_hours", { precision: 10, scale: 1 }),
  plannedDays: integer("planned_days"),
  plannedStartDate: timestamp("planned_start_date"),
  plannedEndDate: timestamp("planned_end_date"),
  plannedCost: decimal("planned_cost", { precision: 12, scale: 2 }),
  
  // Actual (tracked during project)
  actualHours: decimal("actual_hours", { precision: 10, scale: 1 }),
  actualDays: integer("actual_days"),
  actualStartDate: timestamp("actual_start_date"),
  actualEndDate: timestamp("actual_end_date"),
  actualCost: decimal("actual_cost", { precision: 12, scale: 2 }),
  
  // Rates used
  hourlyRate: decimal("hourly_rate", { precision: 10, scale: 2 }),
  dailyRate: decimal("daily_rate", { precision: 10, scale: 2 }),
  
  notes: text("notes"),
  createdById: varchar("created_by_id").references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  projectIdx: index("project_equipment_plans_project_idx").on(table.projectId),
  statusIdx: index("project_equipment_plans_status_idx").on(table.status),
  sourceIdx: index("project_equipment_plans_source_idx").on(table.source),
}));

export const insertProjectEquipmentPlanSchema = createInsertSchema(projectEquipmentPlans).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertProjectEquipmentPlan = z.infer<typeof insertProjectEquipmentPlanSchema>;
export type ProjectEquipmentPlan = typeof projectEquipmentPlans.$inferSelect;

// Rental Equipment Usages - Track actual rental usage for billing/reporting
export const rentalEquipmentUsages = pgTable("rental_equipment_usages", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  projectEquipmentPlanId: varchar("project_equipment_plan_id").notNull().references(() => projectEquipmentPlans.id, { onDelete: "cascade" }),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  vendorId: varchar("vendor_id").notNull().references(() => rentalVendors.id, { onDelete: "restrict" }),
  
  // Rental Details
  rentalCatalogId: varchar("rental_catalog_id").references(() => rentalEquipmentCatalog.id, { onDelete: "set null" }),
  equipmentName: text("equipment_name").notNull(),
  equipmentType: text("equipment_type").notNull(),
  
  // Rental Period
  startDate: timestamp("start_date").notNull(),
  expectedEndDate: timestamp("expected_end_date").notNull(),
  actualEndDate: timestamp("actual_end_date"),
  
  // Status
  status: text("status").notNull().default("BOOKED"), // BOOKED, ACTIVE, EXTENDED, COMPLETED, CANCELLED
  
  // Booking Reference
  vendorConfirmation: text("vendor_confirmation"),
  poNumber: text("po_number"),
  
  // Costs
  dailyRate: decimal("daily_rate", { precision: 10, scale: 2 }).notNull(),
  deliveryFee: decimal("delivery_fee", { precision: 10, scale: 2 }),
  pickupFee: decimal("pickup_fee", { precision: 10, scale: 2 }),
  insuranceCost: decimal("insurance_cost", { precision: 10, scale: 2 }),
  fuelCharges: decimal("fuel_charges", { precision: 10, scale: 2 }),
  damageCharges: decimal("damage_charges", { precision: 10, scale: 2 }),
  otherCharges: decimal("other_charges", { precision: 10, scale: 2 }),
  totalCost: decimal("total_cost", { precision: 12, scale: 2 }),
  
  // Invoice tracking
  invoiceNumber: text("invoice_number"),
  invoiceDate: timestamp("invoice_date"),
  isPaid: boolean("is_paid").notNull().default(false),
  paidDate: timestamp("paid_date"),
  
  notes: text("notes"),
  createdById: varchar("created_by_id").references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  projectIdx: index("rental_equipment_usages_project_idx").on(table.projectId),
  vendorIdx: index("rental_equipment_usages_vendor_idx").on(table.vendorId),
  statusIdx: index("rental_equipment_usages_status_idx").on(table.status),
  planIdx: index("rental_equipment_usages_plan_idx").on(table.projectEquipmentPlanId),
}));

export const insertRentalEquipmentUsageSchema = createInsertSchema(rentalEquipmentUsages).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertRentalEquipmentUsage = z.infer<typeof insertRentalEquipmentUsageSchema>;
export type RentalEquipmentUsage = typeof rentalEquipmentUsages.$inferSelect;

// Vendor Pricing Catalog - Quarterly pricing from suppliers/vendors for materials
// Used to auto-populate bid estimates with current pricing
// Unified system: manual entry + vendor portal submissions + pricebook imports
export const vendorPricingCatalogs = pgTable("vendor_pricing_catalogs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  crmOrganisationId: varchar("crm_organisation_id").notNull().references(() => crmOrganisations.id, { onDelete: "cascade" }),
  organizationId: varchar("organization_id").references(() => organizations.id, { onDelete: "cascade" }), // Contractor receiving this pricing
  
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
export const sowAuditActionEnum = pgEnum("sow_audit_action", ["CREATE", "UPDATE", "DEACTIVATE", "REGENERATE"]);

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
// FEATURE A: AI AUTO-TAKEOFF ANALYSES
// AI-powered blueprint/photo analysis for quantity takeoffs
// ============================================
export const aiTakeoffStatusEnum = pgEnum("ai_takeoff_status", ["PENDING", "PROCESSING", "COMPLETE", "FAILED"]);
export const aiTakeoffModeEnum = pgEnum("ai_takeoff_mode", ["QUICK", "DETAILED"]);

export const aiTakeoffAnalyses = pgTable("ai_takeoff_analyses", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  takeoffSheetId: varchar("takeoff_sheet_id").references(() => takeoffSheets.id, { onDelete: "set null" }),
  tradeType: tradeTypeEnum("trade_type").notNull(),
  status: aiTakeoffStatusEnum("status").notNull().default("PENDING"),
  analysisMode: aiTakeoffModeEnum("analysis_mode").notNull().default("QUICK"),
  fileKey: text("file_key"),
  fileName: text("file_name"),
  detectedItemsJson: text("detected_items_json"),     // AI-detected measurements
  metadataJson: text("metadata_json"),                // Scale, title block, etc.
  aiNotes: text("ai_notes"),
  errorMessage: text("error_message"),
  processingTimeMs: integer("processing_time_ms"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  createdByUserId: varchar("created_by_user_id").references(() => users.id),
}, (table) => ({
  projectIdx: index("ai_takeoff_project_idx").on(table.projectId),
  orgIdx: index("ai_takeoff_org_idx").on(table.organizationId),
}));

export const insertAiTakeoffAnalysisSchema = createInsertSchema(aiTakeoffAnalyses).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertAiTakeoffAnalysis = z.infer<typeof insertAiTakeoffAnalysisSchema>;
export type AiTakeoffAnalysis = typeof aiTakeoffAnalyses.$inferSelect;

// ============================================
// FEATURE B: PROJECT SCHEDULES
// AI-powered scheduling with Gantt-style task management
// ============================================
export const scheduleGeneratedByEnum = pgEnum("schedule_generated_by", ["AI", "MANUAL"]);
export const scheduleTaskStatusEnum = pgEnum("schedule_task_status", ["NOT_STARTED", "IN_PROGRESS", "COMPLETE", "DELAYED", "ON_HOLD"]);

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
  optionsJson: text("options_json"),                  // Buffer days, weather contingency, etc.
  aiNotes: text("ai_notes"),
  version: integer("version").notNull().default(1),
  isActive: boolean("is_active").notNull().default(true),
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
  dependencies: varchar("dependencies").array(),      // Array of task IDs
  percentComplete: integer("percent_complete").notNull().default(0),
  isCriticalPath: boolean("is_critical_path").notNull().default(false),
  isMilestone: boolean("is_milestone").notNull().default(false),
  crewId: varchar("crew_id").references(() => crews.id),
  sowItemIds: varchar("sow_item_ids").array(),
  inspectionId: varchar("inspection_id").references(() => projectInspections.id),
  delayIds: varchar("delay_ids").array(),
  status: scheduleTaskStatusEnum("status").notNull().default("NOT_STARTED"),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  scheduleIdx: index("schedule_tasks_schedule_idx").on(table.scheduleId),
  parentIdx: index("schedule_tasks_parent_idx").on(table.parentTaskId),
}));

export const insertProjectScheduleTaskSchema = createInsertSchema(projectScheduleTasks).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertProjectScheduleTask = z.infer<typeof insertProjectScheduleTaskSchema>;
export type ProjectScheduleTask = typeof projectScheduleTasks.$inferSelect;

// ============================================
// FEATURE C: AI JOBSITE CAMERA ANALYSIS
// Vision AI for safety, progress, and compliance analysis
// ============================================
export const jobsiteAnalysisStatusEnum = pgEnum("jobsite_analysis_status", ["PENDING", "PROCESSING", "COMPLETE", "PARTIAL", "FAILED"]);
export const safetySeverityEnum = pgEnum("safety_severity", ["CRITICAL", "HIGH", "MEDIUM", "LOW"]);

export const jobsiteAnalysisBatches = pgTable("jobsite_analysis_batches", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  analysisDate: date("analysis_date").notNull(),
  tradeType: tradeTypeEnum("trade_type"),
  status: jobsiteAnalysisStatusEnum("status").notNull().default("PENDING"),
  analysisTypes: text("analysis_types").array().default(sql`'{SAFETY,PROGRESS}'`),
  summaryJson: text("summary_json"),                  // Overall scores and summary
  safetyFindingsJson: text("safety_findings_json"),   // Safety issues detected
  progressFindingsJson: text("progress_findings_json"), // Progress observations
  materialFindingsJson: text("material_findings_json"), // Material tracking
  crewFindingsJson: text("crew_findings_json"),       // Crew count/PPE
  aiNotes: text("ai_notes"),
  errorMessage: text("error_message"),
  processingTimeMs: integer("processing_time_ms"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  createdByUserId: varchar("created_by_user_id").references(() => users.id),
}, (table) => ({
  projectIdx: index("jobsite_analysis_project_idx").on(table.projectId),
  dateIdx: index("jobsite_analysis_date_idx").on(table.analysisDate),
}));

export const insertJobsiteAnalysisBatchSchema = createInsertSchema(jobsiteAnalysisBatches).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertJobsiteAnalysisBatch = z.infer<typeof insertJobsiteAnalysisBatchSchema>;
export type JobsiteAnalysisBatch = typeof jobsiteAnalysisBatches.$inferSelect;

export const jobsiteAnalysisPhotos = pgTable("jobsite_analysis_photos", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  batchId: varchar("batch_id").notNull().references(() => jobsiteAnalysisBatches.id, { onDelete: "cascade" }),
  fileKey: text("file_key").notNull(),
  fileUrl: text("file_url").notNull(),
  thumbnailUrl: text("thumbnail_url"),
  originalFilename: text("original_filename"),
  capturedAt: timestamp("captured_at"),
  gpsLatitude: decimal("gps_latitude", { precision: 10, scale: 8 }),
  gpsLongitude: decimal("gps_longitude", { precision: 11, scale: 8 }),
  aiAnnotationsJson: text("ai_annotations_json"),     // Per-photo AI findings
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  batchIdx: index("jobsite_photos_batch_idx").on(table.batchId),
}));

export const insertJobsiteAnalysisPhotoSchema = createInsertSchema(jobsiteAnalysisPhotos).omit({ id: true, createdAt: true });
export type InsertJobsiteAnalysisPhoto = z.infer<typeof insertJobsiteAnalysisPhotoSchema>;
export type JobsiteAnalysisPhoto = typeof jobsiteAnalysisPhotos.$inferSelect;

// ============================================
// FEATURE D: VENDOR PRICING SYNC
// Pricebook import and material pricing management
// ============================================
export const pricebookStatusEnum = pgEnum("pricebook_status", ["PENDING", "PROCESSING", "ACTIVE", "EXPIRED", "SUPERSEDED"]);

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

// ============================================
// FEATURE E: CLIENT PORTAL
// Secure read-only project access for clients/owners
// ============================================
export const clientPortalAccess = pgTable("client_portal_access", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  email: text("email").notNull(),
  name: text("name"),
  accessTokenHash: text("access_token_hash"),
  tokenExpiresAt: timestamp("token_expires_at"),
  lastAccessedAt: timestamp("last_accessed_at"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  createdByUserId: varchar("created_by_user_id").references(() => users.id),
}, (table) => ({
  projectIdx: index("portal_access_project_idx").on(table.projectId),
  emailIdx: index("portal_access_email_idx").on(table.email),
}));

export const insertClientPortalAccessSchema = createInsertSchema(clientPortalAccess).omit({ id: true, createdAt: true });
export type InsertClientPortalAccess = z.infer<typeof insertClientPortalAccessSchema>;
export type ClientPortalAccess = typeof clientPortalAccess.$inferSelect;

export const clientPortalActivity = pgTable("client_portal_activity", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  accessId: varchar("access_id").notNull().references(() => clientPortalAccess.id, { onDelete: "cascade" }),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  action: text("action").notNull(),                   // VIEW_SUMMARY, VIEW_PHOTOS, APPROVE_CO, etc.
  detailsJson: text("details_json"),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  accessIdx: index("portal_activity_access_idx").on(table.accessId),
  projectIdx: index("portal_activity_project_idx").on(table.projectId),
}));

export const insertClientPortalActivitySchema = createInsertSchema(clientPortalActivity).omit({ id: true, createdAt: true });
export type InsertClientPortalActivity = z.infer<typeof insertClientPortalActivitySchema>;
export type ClientPortalActivity = typeof clientPortalActivity.$inferSelect;

// ============================================
// FEATURE F: AI CHANGE ORDER DRAFTS
// AI-generated change order content before finalization
// ============================================
export const aiCoDraftStatusEnum = pgEnum("ai_co_draft_status", ["DRAFT", "CONVERTED", "DISCARDED"]);

export const aiCoDrafts = pgTable("ai_co_drafts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  tradeType: tradeTypeEnum("trade_type"),
  linkedItemsJson: text("linked_items_json"),         // Delay IDs, inspection IDs, etc.
  draftContentJson: text("draft_content_json").notNull(), // Title, description, scope, etc.
  pricingJson: text("pricing_json"),                  // Line items with pricing
  aiConfidence: integer("ai_confidence"),
  aiNotes: text("ai_notes"),
  status: aiCoDraftStatusEnum("status").notNull().default("DRAFT"),
  convertedToCoId: varchar("converted_to_co_id").references(() => changeOrders.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  createdByUserId: varchar("created_by_user_id").references(() => users.id),
}, (table) => ({
  projectIdx: index("ai_co_drafts_project_idx").on(table.projectId),
  orgIdx: index("ai_co_drafts_org_idx").on(table.organizationId),
}));

export const insertAiCoDraftSchema = createInsertSchema(aiCoDrafts).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertAiCoDraft = z.infer<typeof insertAiCoDraftSchema>;
export type AiCoDraft = typeof aiCoDrafts.$inferSelect;

// ============================================
// FEATURE G: MOBILE DEVICES & SYNC
// Device registration and offline sync support
// ============================================
export const mobilePlatformEnum = pgEnum("mobile_platform", ["IOS", "ANDROID", "WEB"]);
export const syncStatusEnum = pgEnum("sync_status", ["IN_PROGRESS", "COMPLETE", "FAILED"]);

export const mobileDevices = pgTable("mobile_devices", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  deviceId: text("device_id").notNull().unique(),
  platform: mobilePlatformEnum("platform").notNull(),
  appVersion: text("app_version"),
  deviceModel: text("device_model"),
  pushToken: text("push_token"),
  lastSyncAt: timestamp("last_sync_at"),
  syncToken: text("sync_token"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  userIdx: index("mobile_devices_user_idx").on(table.userId),
  orgIdx: index("mobile_devices_org_idx").on(table.organizationId),
}));

export const insertMobileDeviceSchema = createInsertSchema(mobileDevices).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertMobileDevice = z.infer<typeof insertMobileDeviceSchema>;
export type MobileDevice = typeof mobileDevices.$inferSelect;

export const mobileSyncLog = pgTable("mobile_sync_log", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  deviceId: varchar("device_id").notNull().references(() => mobileDevices.id, { onDelete: "cascade" }),
  syncType: text("sync_type").notNull(),              // PULL, PUSH, FULL
  syncStartedAt: timestamp("sync_started_at").notNull(),
  syncCompletedAt: timestamp("sync_completed_at"),
  recordsDownloaded: integer("records_downloaded").notNull().default(0),
  recordsUploaded: integer("records_uploaded").notNull().default(0),
  conflicts: integer("conflicts").notNull().default(0),
  status: syncStatusEnum("status").notNull().default("IN_PROGRESS"),
  errorMessage: text("error_message"),
  metadataJson: text("metadata_json"),
}, (table) => ({
  deviceIdx: index("sync_log_device_idx").on(table.deviceId),
}));

export const insertMobileSyncLogSchema = createInsertSchema(mobileSyncLog).omit({ id: true });
export type InsertMobileSyncLog = z.infer<typeof insertMobileSyncLogSchema>;
export type MobileSyncLog = typeof mobileSyncLog.$inferSelect;

export const mobilePendingUploads = pgTable("mobile_pending_uploads", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  deviceId: varchar("device_id").notNull().references(() => mobileDevices.id, { onDelete: "cascade" }),
  localId: text("local_id").notNull(),
  recordType: text("record_type").notNull(),
  recordDataJson: text("record_data_json").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  processedAt: timestamp("processed_at"),
  status: text("status").notNull().default("PENDING"),
  errorMessage: text("error_message"),
}, (table) => ({
  deviceIdx: index("pending_uploads_device_idx").on(table.deviceId),
}));

export const insertMobilePendingUploadSchema = createInsertSchema(mobilePendingUploads).omit({ id: true, createdAt: true });
export type InsertMobilePendingUpload = z.infer<typeof insertMobilePendingUploadSchema>;
export type MobilePendingUpload = typeof mobilePendingUploads.$inferSelect;

// ============================================
// SCHEDULE OF VALUES (SOV) SYSTEM
// Progress billing and value tracking
// ============================================
export const sovStatusEnum = pgEnum("sov_status", ["DRAFT", "PENDING", "APPROVED", "SUBMITTED", "PAID", "ARCHIVED"]);

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
  
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  sovIdx: index("sov_line_items_sov_idx").on(table.sovId),
}));

export const insertSovLineItemSchema = createInsertSchema(sovLineItems).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertSovLineItem = z.infer<typeof insertSovLineItemSchema>;
export type SovLineItem = typeof sovLineItems.$inferSelect;

// ============================================
// WEBSITE BUILDER SYSTEM
// Complete website builder with AI design, blog, gallery, analytics
// ============================================

// Website Builder Enums
export const websiteStatusEnum = pgEnum("website_status", ["DRAFT", "PUBLISHED", "MAINTENANCE"]);
export const websitePageTypeEnum = pgEnum("website_page_type", ["HOME", "ABOUT", "SERVICES", "SAFETY", "GALLERY", "BLOG", "CONTACT", "CUSTOM"]);
export const blogPostStatusEnum = pgEnum("blog_post_status", ["DRAFT", "PUBLISHED", "ARCHIVED"]);
export const blogCommentStatusEnum = pgEnum("blog_comment_status", ["PENDING", "APPROVED", "REJECTED", "SPAM"]);
export const websiteProjectStatusEnum = pgEnum("website_project_status", ["DRAFT", "PUBLISHED", "ARCHIVED"]);
export const socialPlatformEnum = pgEnum("social_platform", ["FACEBOOK", "INSTAGRAM", "LINKEDIN", "TWITTER", "TIKTOK", "YOUTUBE"]);

// Main Website Configuration
export const organizationWebsites = pgTable("organization_websites", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  
  // Site Configuration
  status: websiteStatusEnum("status").notNull().default("DRAFT"),
  siteTitle: text("site_title"),
  siteTagline: text("site_tagline"),
  missionStatement: text("mission_statement"),
  
  // Domain Settings
  subdomain: text("subdomain").unique(), // company.smartmanageai-sites.com
  customDomain: text("custom_domain"),
  customDomainVerified: boolean("custom_domain_verified").default(false),
  sslEnabled: boolean("ssl_enabled").default(true),
  
  // Theme & Branding
  primaryColor: text("primary_color"),
  secondaryColor: text("secondary_color"),
  accentColor: text("accent_color"),
  backgroundColor: text("background_color"),
  textColor: text("text_color"),
  fontFamily: text("font_family"),
  logoUrl: text("logo_url"),
  faviconUrl: text("favicon_url"),
  
  // SEO Global Settings
  defaultMetaTitle: text("default_meta_title"),
  defaultMetaDescription: text("default_meta_description"),
  defaultKeywords: text("default_keywords").array(),
  googleAnalyticsId: text("google_analytics_id"),
  
  // Contact Info (can override organization)
  contactEmail: text("contact_email"),
  contactPhone: text("contact_phone"),
  contactAddress: text("contact_address"),
  
  // Features Toggle
  blogEnabled: boolean("blog_enabled").default(true),
  galleryEnabled: boolean("gallery_enabled").default(true),
  contactFormEnabled: boolean("contact_form_enabled").default(true),
  analyticsEnabled: boolean("analytics_enabled").default(true),
  
  // Publishing
  lastPublishedAt: timestamp("last_published_at"),
  lastPublishedByUserId: varchar("last_published_by_user_id").references(() => users.id),
  publishedBundleUrl: text("published_bundle_url"),
  
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  orgIdx: index("website_org_idx").on(table.organizationId),
  subdomainIdx: index("website_subdomain_idx").on(table.subdomain),
}));

export const insertOrganizationWebsiteSchema = createInsertSchema(organizationWebsites).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertOrganizationWebsite = z.infer<typeof insertOrganizationWebsiteSchema>;
export type OrganizationWebsite = typeof organizationWebsites.$inferSelect;

// Website Pages
export const organizationWebsitePages = pgTable("organization_website_pages", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  websiteId: varchar("website_id").notNull().references(() => organizationWebsites.id, { onDelete: "cascade" }),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  
  // Page Identity
  pageType: websitePageTypeEnum("page_type").notNull().default("CUSTOM"),
  pageSlug: text("page_slug").notNull(), // e.g., "about", "services/concrete"
  pageTitle: text("page_title").notNull(),
  
  // Content
  contentJson: text("content_json"), // Block-based content structure
  heroImageUrl: text("hero_image_url"),
  aiGenerated: boolean("ai_generated").default(false),
  
  // SEO
  metaTitle: text("meta_title"),
  metaDescription: text("meta_description"),
  keywords: text("keywords").array(),
  richSchemaJson: text("rich_schema_json"), // JSON-LD structured data
  canonicalUrl: text("canonical_url"),
  noIndex: boolean("no_index").default(false),
  
  // Display Settings
  isPublished: boolean("is_published").default(false),
  showInNavigation: boolean("show_in_navigation").default(true),
  navigationOrder: integer("navigation_order").default(0),
  
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  websiteIdx: index("website_pages_website_idx").on(table.websiteId),
  orgIdx: index("website_pages_org_idx").on(table.organizationId),
  slugIdx: index("website_pages_slug_idx").on(table.websiteId, table.pageSlug),
}));

export const insertOrganizationWebsitePageSchema = createInsertSchema(organizationWebsitePages).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertOrganizationWebsitePage = z.infer<typeof insertOrganizationWebsitePageSchema>;
export type OrganizationWebsitePage = typeof organizationWebsitePages.$inferSelect;

// Blog Posts
export const websiteBlogPosts = pgTable("website_blog_posts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  websiteId: varchar("website_id").notNull().references(() => organizationWebsites.id, { onDelete: "cascade" }),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  
  // Post Content
  slug: text("slug").notNull(),
  title: text("title").notNull(),
  excerpt: text("excerpt"),
  contentJson: text("content_json"), // Block-based editor content
  contentHtml: text("content_html"), // Rendered HTML for public display
  coverImageUrl: text("cover_image_url"),
  
  // Categorization
  category: text("category"),
  tags: text("tags").array(),
  
  // Author
  authorId: varchar("author_id").references(() => users.id),
  authorName: text("author_name"),
  
  // AI Generation
  aiGenerated: boolean("ai_generated").default(false),
  aiPrompt: text("ai_prompt"),
  
  // SEO
  metaTitle: text("meta_title"),
  metaDescription: text("meta_description"),
  keywords: text("keywords").array(),
  richSchemaJson: text("rich_schema_json"),
  
  // Status & Publishing
  status: blogPostStatusEnum("status").notNull().default("DRAFT"),
  publishedAt: timestamp("published_at"),
  featuredPost: boolean("featured_post").default(false),
  
  // Engagement
  viewCount: integer("view_count").default(0),
  shareCount: integer("share_count").default(0),
  commentsEnabled: boolean("comments_enabled").default(true),
  
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  websiteIdx: index("blog_posts_website_idx").on(table.websiteId),
  orgIdx: index("blog_posts_org_idx").on(table.organizationId),
  slugIdx: index("blog_posts_slug_idx").on(table.websiteId, table.slug),
  statusIdx: index("blog_posts_status_idx").on(table.status),
}));

export const insertWebsiteBlogPostSchema = createInsertSchema(websiteBlogPosts).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertWebsiteBlogPost = z.infer<typeof insertWebsiteBlogPostSchema>;
export type WebsiteBlogPost = typeof websiteBlogPosts.$inferSelect;

// Blog Comments
export const websiteBlogComments = pgTable("website_blog_comments", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  postId: varchar("post_id").notNull().references(() => websiteBlogPosts.id, { onDelete: "cascade" }),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  
  // Comment Content
  authorName: text("author_name").notNull(),
  authorEmail: text("author_email").notNull(),
  authorWebsite: text("author_website"),
  content: text("content").notNull(),
  
  // Moderation
  status: blogCommentStatusEnum("status").notNull().default("PENDING"),
  moderatedById: varchar("moderated_by_id").references(() => users.id),
  moderatedAt: timestamp("moderated_at"),
  
  // Replies
  parentCommentId: varchar("parent_comment_id"),
  
  // Metadata
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  postIdx: index("blog_comments_post_idx").on(table.postId),
  statusIdx: index("blog_comments_status_idx").on(table.status),
}));

export const insertWebsiteBlogCommentSchema = createInsertSchema(websiteBlogComments).omit({ id: true, createdAt: true });
export type InsertWebsiteBlogComment = z.infer<typeof insertWebsiteBlogCommentSchema>;
export type WebsiteBlogComment = typeof websiteBlogComments.$inferSelect;

// Project Gallery / Portfolio
export const websiteProjects = pgTable("website_projects", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  websiteId: varchar("website_id").notNull().references(() => organizationWebsites.id, { onDelete: "cascade" }),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  
  // Link to actual project (optional)
  linkedProjectId: varchar("linked_project_id").references(() => projects.id, { onDelete: "set null" }),
  
  // Project Details
  slug: text("slug").notNull(),
  title: text("title").notNull(),
  shortDescription: text("short_description"),
  fullDescription: text("full_description"),
  
  // Categorization
  serviceType: text("service_type"), // Matches trade/service type
  projectType: text("project_type"), // Commercial, Residential, Industrial
  location: text("location"),
  completionDate: date("completion_date"),
  
  // Media
  coverImageUrl: text("cover_image_url"),
  beforeImageUrl: text("before_image_url"),
  afterImageUrl: text("after_image_url"),
  
  // AI Content
  aiGenerated: boolean("ai_generated").default(false),
  aiPrompt: text("ai_prompt"),
  
  // SEO
  metaTitle: text("meta_title"),
  metaDescription: text("meta_description"),
  keywords: text("keywords").array(),
  richSchemaJson: text("rich_schema_json"),
  
  // Display Settings
  status: websiteProjectStatusEnum("status").notNull().default("DRAFT"),
  featured: boolean("featured").default(false),
  displayOrder: integer("display_order").default(0),
  
  // Engagement
  viewCount: integer("view_count").default(0),
  
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  websiteIdx: index("website_projects_website_idx").on(table.websiteId),
  orgIdx: index("website_projects_org_idx").on(table.organizationId),
  slugIdx: index("website_projects_slug_idx").on(table.websiteId, table.slug),
  statusIdx: index("website_projects_status_idx").on(table.status),
}));

export const insertWebsiteProjectSchema = createInsertSchema(websiteProjects).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertWebsiteProject = z.infer<typeof insertWebsiteProjectSchema>;
export type WebsiteProject = typeof websiteProjects.$inferSelect;

// Project Gallery Images
export const websiteProjectImages = pgTable("website_project_images", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: varchar("project_id").notNull().references(() => websiteProjects.id, { onDelete: "cascade" }),
  
  imageUrl: text("image_url").notNull(),
  thumbnailUrl: text("thumbnail_url"),
  altText: text("alt_text"),
  caption: text("caption"),
  displayOrder: integer("display_order").default(0),
  
  // AI-generated caption
  aiCaption: text("ai_caption"),
  
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  projectIdx: index("project_images_project_idx").on(table.projectId),
}));

export const insertWebsiteProjectImageSchema = createInsertSchema(websiteProjectImages).omit({ id: true, createdAt: true });
export type InsertWebsiteProjectImage = z.infer<typeof insertWebsiteProjectImageSchema>;
export type WebsiteProjectImage = typeof websiteProjectImages.$inferSelect;

// Website Analytics - Daily Aggregates
export const websiteAnalyticsDaily = pgTable("website_analytics_daily", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  websiteId: varchar("website_id").notNull().references(() => organizationWebsites.id, { onDelete: "cascade" }),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  
  // Date dimension
  date: date("date").notNull(),
  
  // Traffic Metrics
  pageViews: integer("page_views").default(0),
  uniqueVisitors: integer("unique_visitors").default(0),
  sessions: integer("sessions").default(0),
  avgSessionDuration: integer("avg_session_duration").default(0), // in seconds
  bounceRate: decimal("bounce_rate", { precision: 5, scale: 2 }),
  
  // Top Pages (JSON array)
  topPagesJson: text("top_pages_json"),
  
  // Traffic Sources (JSON)
  trafficSourcesJson: text("traffic_sources_json"),
  
  // Lead Metrics
  contactFormSubmissions: integer("contact_form_submissions").default(0),
  phoneClicks: integer("phone_clicks").default(0),
  emailClicks: integer("email_clicks").default(0),
  
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  websiteDateIdx: index("analytics_daily_website_date_idx").on(table.websiteId, table.date),
  orgIdx: index("analytics_daily_org_idx").on(table.organizationId),
}));

export const insertWebsiteAnalyticsDailySchema = createInsertSchema(websiteAnalyticsDaily).omit({ id: true, createdAt: true });
export type InsertWebsiteAnalyticsDaily = z.infer<typeof insertWebsiteAnalyticsDailySchema>;
export type WebsiteAnalyticsDaily = typeof websiteAnalyticsDaily.$inferSelect;

// Website Analytics - Individual Events
export const websiteAnalyticsEvents = pgTable("website_analytics_events", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  websiteId: varchar("website_id").notNull().references(() => organizationWebsites.id, { onDelete: "cascade" }),
  
  // Session Info
  sessionId: text("session_id").notNull(),
  visitorId: text("visitor_id"), // Persistent visitor identifier
  
  // Event Details
  eventType: text("event_type").notNull(), // PAGE_VIEW, CLICK, FORM_SUBMIT, etc.
  pagePath: text("page_path"),
  pageTitle: text("page_title"),
  referrer: text("referrer"),
  
  // Event Data
  eventDataJson: text("event_data_json"), // Custom event properties
  
  // Visitor Info
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  deviceType: text("device_type"), // desktop, mobile, tablet
  browser: text("browser"),
  os: text("os"),
  country: text("country"),
  city: text("city"),
  
  // UTM Parameters
  utmSource: text("utm_source"),
  utmMedium: text("utm_medium"),
  utmCampaign: text("utm_campaign"),
  
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  websiteIdx: index("analytics_events_website_idx").on(table.websiteId),
  sessionIdx: index("analytics_events_session_idx").on(table.sessionId),
  eventTypeIdx: index("analytics_events_type_idx").on(table.eventType),
  createdAtIdx: index("analytics_events_created_idx").on(table.createdAt),
}));

export const insertWebsiteAnalyticsEventSchema = createInsertSchema(websiteAnalyticsEvents).omit({ id: true, createdAt: true });
export type InsertWebsiteAnalyticsEvent = z.infer<typeof insertWebsiteAnalyticsEventSchema>;
export type WebsiteAnalyticsEvent = typeof websiteAnalyticsEvents.$inferSelect;

// Social Media Links
export const organizationSocialLinks = pgTable("organization_social_links", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }).unique(),
  
  facebookUrl: text("facebook_url"),
  instagramUrl: text("instagram_url"),
  linkedinUrl: text("linkedin_url"),
  twitterUrl: text("twitter_url"),
  tiktokUrl: text("tiktok_url"),
  youtubeUrl: text("youtube_url"),
  
  // Display Settings
  showOnWebsite: boolean("show_on_website").default(true),
  showInFooter: boolean("show_in_footer").default(true),
  showOnContact: boolean("show_on_contact").default(true),
  
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  orgIdx: index("social_links_org_idx").on(table.organizationId),
}));

export const insertOrganizationSocialLinksSchema = createInsertSchema(organizationSocialLinks).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertOrganizationSocialLinks = z.infer<typeof insertOrganizationSocialLinksSchema>;
export type OrganizationSocialLinks = typeof organizationSocialLinks.$inferSelect;

// AI Social Post History
export const socialPostHistory = pgTable("social_post_history", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  
  // Platform & Content
  platform: socialPlatformEnum("platform").notNull(),
  postContent: text("post_content").notNull(),
  hashtags: text("hashtags").array(),
  
  // Content Source
  sourceType: text("source_type"), // BLOG_POST, PROJECT, EVENT, SAFETY, CUSTOM
  sourceId: varchar("source_id"), // ID of linked blog post or project
  
  // AI Generation
  aiPrompt: text("ai_prompt"),
  tone: text("tone"), // professional, casual, marketing, humorous
  
  // Suggested Image
  suggestedImageUrl: text("suggested_image_url"),
  suggestedImagePrompt: text("suggested_image_prompt"),
  
  // Publishing Status
  exported: boolean("exported").default(false),
  exportedAt: timestamp("exported_at"),
  
  createdById: varchar("created_by_id").references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  orgIdx: index("social_post_history_org_idx").on(table.organizationId),
  platformIdx: index("social_post_history_platform_idx").on(table.platform),
}));

export const insertSocialPostHistorySchema = createInsertSchema(socialPostHistory).omit({ id: true, createdAt: true });
export type InsertSocialPostHistory = z.infer<typeof insertSocialPostHistorySchema>;
export type SocialPostHistory = typeof socialPostHistory.$inferSelect;

// Website Contact Form Submissions (CRM Integration)
export const websiteContactSubmissions = pgTable("website_contact_submissions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  websiteId: varchar("website_id").notNull().references(() => organizationWebsites.id, { onDelete: "cascade" }),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  
  // Contact Info
  name: text("name").notNull(),
  email: text("email").notNull(),
  phone: text("phone"),
  company: text("company"),
  
  // Message
  subject: text("subject"),
  message: text("message").notNull(),
  
  // Service Interest
  serviceInterest: text("service_interest"),
  projectType: text("project_type"),
  estimatedBudget: text("estimated_budget"),
  preferredContactMethod: text("preferred_contact_method"),
  
  // Source Tracking
  sourcePage: text("source_page"),
  utmSource: text("utm_source"),
  utmMedium: text("utm_medium"),
  utmCampaign: text("utm_campaign"),
  
  // CRM Integration
  crmOrganisationId: varchar("crm_organisation_id").references(() => crmOrganisations.id),
  crmContactId: varchar("crm_contact_id").references(() => crmContacts.id),
  convertedToCrm: boolean("converted_to_crm").default(false),
  convertedAt: timestamp("converted_at"),
  
  // Status
  read: boolean("read").default(false),
  readAt: timestamp("read_at"),
  responded: boolean("responded").default(false),
  respondedAt: timestamp("responded_at"),
  
  // Metadata
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  websiteIdx: index("contact_submissions_website_idx").on(table.websiteId),
  orgIdx: index("contact_submissions_org_idx").on(table.organizationId),
  emailIdx: index("contact_submissions_email_idx").on(table.email),
}));

export const insertWebsiteContactSubmissionSchema = createInsertSchema(websiteContactSubmissions).omit({ id: true, createdAt: true });
export type InsertWebsiteContactSubmission = z.infer<typeof insertWebsiteContactSubmissionSchema>;
export type WebsiteContactSubmission = typeof websiteContactSubmissions.$inferSelect;

// ====================================================================
// EMAIL AI SYSTEM
// ====================================================================

// Email Provider Enum
export const emailProviderEnum = pgEnum("email_provider", ["GMAIL", "OUTLOOK", "IMAP"]);

// Email Thread Status Enum
export const emailThreadStatusEnum = pgEnum("email_thread_status", ["OPEN", "ARCHIVED", "IGNORED"]);

// Email Classification Enum
export const emailClassificationEnum = pgEnum("email_classification", [
  "PROJECT_UPDATE",
  "BID_INVITE",
  "BID_RFI",
  "CHANGE_ORDER_REQUEST",
  "SUBMITTAL_REQUEST",
  "PAY_APP",
  "INVOICE",
  "DELAY_NOTICE",
  "SAFETY_ISSUE",
  "DELIVERY_NOTICE",
  "TIME_CLOCK_ISSUE",
  "VENDOR_PRICING",
  "GENERAL_COMMUNICATION",
  "SPAM_OR_IRRELEVANT",
  "OTHER"
]);

// Email Task Source Enum  
export const emailTaskSourceEnum = pgEnum("email_task_source", ["EMAIL", "MANUAL", "AI_GENERATED"]);

// Email Accounts Table (linked email accounts per user)
export const emailAccounts = pgTable("email_accounts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  provider: emailProviderEnum("provider").notNull(),
  emailAddress: text("email_address").notNull(),
  displayName: text("display_name"),
  
  // OAuth fields (for Gmail/Outlook)
  oauthProviderId: text("oauth_provider_id"),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  expiresAt: timestamp("expires_at"),
  
  // IMAP/SMTP fields
  imapHost: text("imap_host"),
  imapPort: integer("imap_port"),
  imapSecure: boolean("imap_secure"),
  smtpHost: text("smtp_host"),
  smtpPort: integer("smtp_port"),
  smtpSecure: boolean("smtp_secure"),
  imapUsername: text("imap_username"),
  imapPassword: text("imap_password"), // Should be encrypted in production
  
  isActive: boolean("is_active").notNull().default(true),
  lastSyncedAt: timestamp("last_synced_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  orgIdx: index("email_accounts_org_idx").on(table.organizationId),
  userIdx: index("email_accounts_user_idx").on(table.userId),
  emailIdx: index("email_accounts_email_idx").on(table.emailAddress),
}));

export const insertEmailAccountSchema = createInsertSchema(emailAccounts).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertEmailAccount = z.infer<typeof insertEmailAccountSchema>;
export type EmailAccount = typeof emailAccounts.$inferSelect;

// Email Threads Table
export const emailThreads = pgTable("email_threads", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  emailAccountId: varchar("email_account_id").notNull().references(() => emailAccounts.id, { onDelete: "cascade" }),
  
  subject: text("subject").notNull(),
  externalThreadId: text("external_thread_id"), // Provider's thread ID
  
  // Linked entities (optional)
  projectId: varchar("project_id").references(() => projects.id, { onDelete: "set null" }),
  bidId: varchar("bid_id").references(() => bids.id, { onDelete: "set null" }),
  vendorId: varchar("vendor_id").references(() => crmOrganisations.id, { onDelete: "set null" }),
  
  status: emailThreadStatusEnum("status").notNull().default("OPEN"),
  messageCount: integer("message_count").notNull().default(0),
  unreadCount: integer("unread_count").notNull().default(0),
  lastMessageAt: timestamp("last_message_at").notNull().defaultNow(),
  
  // AI-generated fields
  aiSummary: text("ai_summary"),
  primaryClassification: emailClassificationEnum("primary_classification"),
  aiMetadata: text("ai_metadata"), // JSON with extracted entities
  
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  orgIdx: index("email_threads_org_idx").on(table.organizationId),
  accountIdx: index("email_threads_account_idx").on(table.emailAccountId),
  projectIdx: index("email_threads_project_idx").on(table.projectId),
  bidIdx: index("email_threads_bid_idx").on(table.bidId),
  statusIdx: index("email_threads_status_idx").on(table.status),
  lastMessageIdx: index("email_threads_last_message_idx").on(table.lastMessageAt),
}));

export const insertEmailThreadSchema = createInsertSchema(emailThreads).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertEmailThread = z.infer<typeof insertEmailThreadSchema>;
export type EmailThread = typeof emailThreads.$inferSelect;

// Email Messages Table
export const emailMessages = pgTable("email_messages", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  emailAccountId: varchar("email_account_id").notNull().references(() => emailAccounts.id, { onDelete: "cascade" }),
  threadId: varchar("thread_id").notNull().references(() => emailThreads.id, { onDelete: "cascade" }),
  
  externalId: text("external_id").notNull(), // Provider message ID
  
  fromAddress: text("from_address").notNull(),
  fromName: text("from_name"),
  toAddresses: text("to_addresses"), // JSON array
  ccAddresses: text("cc_addresses"), // JSON array
  bccAddresses: text("bcc_addresses"), // JSON array
  
  subject: text("subject").notNull(),
  bodyText: text("body_text"),
  bodyHtml: text("body_html"),
  snippet: text("snippet"), // Preview text
  
  receivedAt: timestamp("received_at").notNull(),
  isRead: boolean("is_read").notNull().default(false),
  isIncoming: boolean("is_incoming").notNull().default(true),
  hasAttachments: boolean("has_attachments").notNull().default(false),
  
  // AI Classification
  classification: emailClassificationEnum("classification"),
  aiMetadata: text("ai_metadata"), // JSON with extracted data
  aiAnalyzedAt: timestamp("ai_analyzed_at"),
  
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  orgIdx: index("email_messages_org_idx").on(table.organizationId),
  accountIdx: index("email_messages_account_idx").on(table.emailAccountId),
  threadIdx: index("email_messages_thread_idx").on(table.threadId),
  externalIdIdx: index("email_messages_external_id_idx").on(table.externalId),
  receivedAtIdx: index("email_messages_received_at_idx").on(table.receivedAt),
  classificationIdx: index("email_messages_classification_idx").on(table.classification),
}));

export const insertEmailMessageSchema = createInsertSchema(emailMessages).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertEmailMessage = z.infer<typeof insertEmailMessageSchema>;
export type EmailMessage = typeof emailMessages.$inferSelect;

// Email Attachments Table
export const emailAttachments = pgTable("email_attachments", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  emailMessageId: varchar("email_message_id").notNull().references(() => emailMessages.id, { onDelete: "cascade" }),
  
  filename: text("filename").notNull(),
  contentType: text("content_type").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  storageKey: text("storage_key").notNull(), // Object storage key
  
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  orgIdx: index("email_attachments_org_idx").on(table.organizationId),
  messageIdx: index("email_attachments_message_idx").on(table.emailMessageId),
}));

export const insertEmailAttachmentSchema = createInsertSchema(emailAttachments).omit({ id: true, createdAt: true });
export type InsertEmailAttachment = z.infer<typeof insertEmailAttachmentSchema>;
export type EmailAttachment = typeof emailAttachments.$inferSelect;

// DEPRECATED: email_tasks table
// Email-derived tasks are now stored in the unified 'tasks' table (line 633) with sourceType="EMAIL"
// The emailTasks table is kept for migration reference only. New code should use the unified tasks table.
// See tasks.sourceType, tasks.emailThreadId, tasks.emailMessageId, tasks.aiMetadata for email task fields.

export const emailTasks = pgTable("email_tasks", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  createdByUserId: varchar("created_by_user_id").notNull().references(() => users.id),
  assignedToUserId: varchar("assigned_to_user_id").references(() => users.id),
  projectId: varchar("project_id").references(() => projects.id, { onDelete: "set null" }),
  bidId: varchar("bid_id").references(() => bids.id, { onDelete: "set null" }),
  vendorId: varchar("vendor_id").references(() => crmOrganisations.id, { onDelete: "set null" }),
  emailThreadId: varchar("email_thread_id").references(() => emailThreads.id, { onDelete: "set null" }),
  emailMessageId: varchar("email_message_id").references(() => emailMessages.id, { onDelete: "set null" }),
  title: text("title").notNull(),
  description: text("description"),
  status: aiTaskStatusEnum("status").notNull().default("PENDING"),
  priority: aiTaskPriorityEnum("priority").notNull().default("MEDIUM"),
  dueDate: timestamp("due_date"),
  sourceType: emailTaskSourceEnum("source_type").notNull().default("EMAIL"),
  aiMetadata: text("ai_metadata"),
  completedAt: timestamp("completed_at"),
  completedByUserId: varchar("completed_by_user_id").references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  orgIdx: index("email_tasks_org_idx").on(table.organizationId),
  projectIdx: index("email_tasks_project_idx").on(table.projectId),
  assignedIdx: index("email_tasks_assigned_idx").on(table.assignedToUserId),
  statusIdx: index("email_tasks_status_idx").on(table.status),
  threadIdx: index("email_tasks_thread_idx").on(table.emailThreadId),
  dueDateIdx: index("email_tasks_due_date_idx").on(table.dueDate),
}));

// DEPRECATED: Use insertTaskSchema and Task types instead
export const insertEmailTaskSchema = createInsertSchema(emailTasks).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertEmailTask = z.infer<typeof insertEmailTaskSchema>;
export type EmailTask = typeof emailTasks.$inferSelect;

// AI Email Summaries Table (daily/weekly digest cache)
export const emailSummaries = pgTable("email_summaries", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  
  summaryType: text("summary_type").notNull(), // "DAILY" or "WEEKLY"
  periodStart: timestamp("period_start").notNull(),
  periodEnd: timestamp("period_end").notNull(),
  
  summaryContent: text("summary_content").notNull(), // AI-generated summary
  highlightsJson: text("highlights_json"), // JSON with key points
  
  emailCount: integer("email_count").notNull().default(0),
  tasksCreated: integer("tasks_created").notNull().default(0),
  
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  orgIdx: index("email_summaries_org_idx").on(table.organizationId),
  userIdx: index("email_summaries_user_idx").on(table.userId),
  periodIdx: index("email_summaries_period_idx").on(table.periodStart, table.periodEnd),
}));

export const insertEmailSummarySchema = createInsertSchema(emailSummaries).omit({ id: true, createdAt: true });
export type InsertEmailSummary = z.infer<typeof insertEmailSummarySchema>;
export type EmailSummary = typeof emailSummaries.$inferSelect;

// ============================================
// DASHBOARD CUSTOMIZATION SYSTEM
// ============================================

// Dashboard Widget Types - Available widgets for the dashboard
export const dashboardWidgetTypeEnum = pgEnum("dashboard_widget_type", [
  "QUICK_STATS",
  "AI_INSIGHTS", 
  "MESSAGES",
  "NOTIFICATIONS",
  "CALENDAR_EVENTS",
  "ACTIVE_PROJECTS",
  "ACTIVE_BIDS",
  "AI_TASKS",
  "CREW_ASSIGNMENTS",
  "RECENT_ACTIVITY",
  "PROJECT_HEALTH",
  "BUDGET_OVERVIEW"
]);

// User Dashboard Permissions - Admin-controlled access to customization
export const userDashboardPermissions = pgTable("user_dashboard_permissions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  
  // Customization permissions
  canCustomizeDashboard: boolean("can_customize_dashboard").notNull().default(false),
  canCustomizeColorScheme: boolean("can_customize_color_scheme").notNull().default(false),
  
  // Granted by admin
  grantedByUserId: varchar("granted_by_user_id").references(() => users.id),
  grantedAt: timestamp("granted_at"),
  
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  orgIdx: index("user_dashboard_permissions_org_idx").on(table.organizationId),
  userIdx: index("user_dashboard_permissions_user_idx").on(table.userId),
  orgUserUnique: unique("user_dashboard_permissions_org_user_unique").on(table.organizationId, table.userId),
}));

export const insertUserDashboardPermissionSchema = createInsertSchema(userDashboardPermissions).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertUserDashboardPermission = z.infer<typeof insertUserDashboardPermissionSchema>;
export type UserDashboardPermission = typeof userDashboardPermissions.$inferSelect;

// User Dashboard Layouts - Store widget arrangement per user
export const userDashboardLayouts = pgTable("user_dashboard_layouts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  
  // Layout configuration stored as JSON
  // Format: { widgets: [{ id, type, x, y, w, h, visible }], gridCols, version }
  layoutConfig: text("layout_config").notNull(),
  
  // Track if using default or custom layout
  isCustom: boolean("is_custom").notNull().default(false),
  
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  orgIdx: index("user_dashboard_layouts_org_idx").on(table.organizationId),
  userIdx: index("user_dashboard_layouts_user_idx").on(table.userId),
  orgUserUnique: unique("user_dashboard_layouts_org_user_unique").on(table.organizationId, table.userId),
}));

export const insertUserDashboardLayoutSchema = createInsertSchema(userDashboardLayouts).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertUserDashboardLayout = z.infer<typeof insertUserDashboardLayoutSchema>;
export type UserDashboardLayout = typeof userDashboardLayouts.$inferSelect;

// User Color Palettes - Store color scheme preferences per user
export const userColorPalettes = pgTable("user_color_palettes", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  
  // Palette name (for presets or custom)
  paletteName: text("palette_name").notNull().default("Default"),
  isPreset: boolean("is_preset").notNull().default(false),
  
  // Light mode colors (HSL format without hsl() wrapper, e.g., "220 14% 96%")
  lightPrimary: text("light_primary"),
  lightPrimaryForeground: text("light_primary_foreground"),
  lightSecondary: text("light_secondary"),
  lightSecondaryForeground: text("light_secondary_foreground"),
  lightAccent: text("light_accent"),
  lightAccentForeground: text("light_accent_foreground"),
  lightBackground: text("light_background"),
  lightForeground: text("light_foreground"),
  lightMuted: text("light_muted"),
  lightMutedForeground: text("light_muted_foreground"),
  lightCard: text("light_card"),
  lightCardForeground: text("light_card_foreground"),
  lightBorder: text("light_border"),
  
  // Dark mode colors (HSL format)
  darkPrimary: text("dark_primary"),
  darkPrimaryForeground: text("dark_primary_foreground"),
  darkSecondary: text("dark_secondary"),
  darkSecondaryForeground: text("dark_secondary_foreground"),
  darkAccent: text("dark_accent"),
  darkAccentForeground: text("dark_accent_foreground"),
  darkBackground: text("dark_background"),
  darkForeground: text("dark_foreground"),
  darkMuted: text("dark_muted"),
  darkMutedForeground: text("dark_muted_foreground"),
  darkCard: text("dark_card"),
  darkCardForeground: text("dark_card_foreground"),
  darkBorder: text("dark_border"),
  
  // Contrast validation metadata
  contrastValidated: boolean("contrast_validated").notNull().default(false),
  lastValidatedAt: timestamp("last_validated_at"),
  
  // Track if using custom or org default
  isActive: boolean("is_active").notNull().default(false),
  
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  orgIdx: index("user_color_palettes_org_idx").on(table.organizationId),
  userIdx: index("user_color_palettes_user_idx").on(table.userId),
}));

export const insertUserColorPaletteSchema = createInsertSchema(userColorPalettes).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertUserColorPalette = z.infer<typeof insertUserColorPaletteSchema>;
export type UserColorPalette = typeof userColorPalettes.$inferSelect;

// Hustler Multi-Organization System
// Allows HUSTLER role users to own/manage multiple organizations
export const hustlerOrganizations = pgTable("hustler_organizations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  roleOverride: userRoleEnum("role_override"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  userIdx: index("hustler_org_user_idx").on(table.userId),
  orgIdx: index("hustler_org_org_idx").on(table.organizationId),
  userOrgUnique: unique("hustler_org_user_org_unique").on(table.userId, table.organizationId),
}));

export const insertHustlerOrganizationSchema = createInsertSchema(hustlerOrganizations).omit({ id: true, createdAt: true });
export type InsertHustlerOrganization = z.infer<typeof insertHustlerOrganizationSchema>;
export type HustlerOrganization = typeof hustlerOrganizations.$inferSelect;

// Hustler Link Requests - Invitation/Request workflow for linking HUSTLERs to organizations
export const hustlerLinkRequestStatusEnum = pgEnum("hustler_link_request_status", ["PENDING", "APPROVED", "REJECTED", "EXPIRED", "REVOKED"]);

export const hustlerLinkRequests = pgTable("hustler_link_requests", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  // The HUSTLER user requesting or being invited
  hustlerUserId: varchar("hustler_user_id").references(() => users.id, { onDelete: "cascade" }),
  hustlerEmail: text("hustler_email"), // Email for pending invites where user may not exist yet
  // The organization to be linked
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  // Who initiated the request
  initiatedByUserId: varchar("initiated_by_user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  // Type: INVITE (admin invites hustler) or REQUEST (hustler requests access)
  requestType: text("request_type").notNull().default("INVITE"), // "INVITE" or "REQUEST"
  // Status workflow
  status: hustlerLinkRequestStatusEnum("status").notNull().default("PENDING"),
  // Secure token for email invites
  inviteToken: text("invite_token"),
  inviteTokenHash: text("invite_token_hash"),
  // Optional role override granted upon approval
  roleOverride: userRoleEnum("role_override"),
  // Message from requester/inviter
  message: text("message"),
  // Timestamps
  expiresAt: timestamp("expires_at"),
  respondedAt: timestamp("responded_at"),
  respondedByUserId: varchar("responded_by_user_id").references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  hustlerIdx: index("hustler_link_req_hustler_idx").on(table.hustlerUserId),
  orgIdx: index("hustler_link_req_org_idx").on(table.organizationId),
  statusIdx: index("hustler_link_req_status_idx").on(table.status),
  tokenIdx: index("hustler_link_req_token_idx").on(table.inviteTokenHash),
}));

export const insertHustlerLinkRequestSchema = createInsertSchema(hustlerLinkRequests).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertHustlerLinkRequest = z.infer<typeof insertHustlerLinkRequestSchema>;
export type HustlerLinkRequest = typeof hustlerLinkRequests.$inferSelect;

// HUSTLER Delegates - COO and other executives who can manage organizations on behalf of the HUSTLER
export const hustlerDelegateRoleEnum = pgEnum("hustler_delegate_role", ["COO", "CFO", "OPERATIONS_MANAGER"]);

export const hustlerDelegates = pgTable("hustler_delegates", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  // The HUSTLER who owns this delegate relationship
  hustlerUserId: varchar("hustler_user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  // The delegate user (COO, etc.)
  delegateUserId: varchar("delegate_user_id").references(() => users.id, { onDelete: "cascade" }),
  // Email for pending invites where delegate user may not exist yet
  delegateEmail: text("delegate_email"),
  // The delegate's role in the HUSTLER's portfolio
  delegateRole: hustlerDelegateRoleEnum("delegate_role").notNull().default("COO"),
  // Invite token for pending invites
  inviteToken: text("invite_token"),
  inviteTokenHash: text("invite_token_hash"),
  // Status
  status: hustlerLinkRequestStatusEnum("status").notNull().default("PENDING"),
  // Permissions - what the delegate can do
  canCreateOrganizations: boolean("can_create_organizations").notNull().default(true),
  canManageAllOrganizations: boolean("can_manage_all_organizations").notNull().default(true),
  canViewFinancials: boolean("can_view_financials").notNull().default(true),
  canInviteOtherDelegates: boolean("can_invite_other_delegates").notNull().default(false),
  // Timestamps
  expiresAt: timestamp("expires_at"),
  acceptedAt: timestamp("accepted_at"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  hustlerIdx: index("hustler_delegate_hustler_idx").on(table.hustlerUserId),
  delegateIdx: index("hustler_delegate_delegate_idx").on(table.delegateUserId),
  tokenIdx: index("hustler_delegate_token_idx").on(table.inviteTokenHash),
  uniqueDelegate: unique("hustler_delegate_unique").on(table.hustlerUserId, table.delegateUserId),
}));

export const insertHustlerDelegateSchema = createInsertSchema(hustlerDelegates).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertHustlerDelegate = z.infer<typeof insertHustlerDelegateSchema>;
export type HustlerDelegate = typeof hustlerDelegates.$inferSelect;

// ============================================
// SUBCONTRACTOR BID REQUEST NETWORK SYSTEM
// Platform-wide bid solicitation like PlanHub/BuildingConnected
// ============================================

// Enums for bid request network
export const bidRequestStatusEnum = pgEnum("bid_request_status", [
  "DRAFT",           // GC is preparing the request
  "OPEN",            // Request is open for submissions
  "CLOSED",          // Deadline passed or manually closed
  "AWARDED",         // A sub has been selected
  "CANCELLED"        // Request cancelled
]);

export const bidInvitationStatusEnum = pgEnum("bid_invitation_status", [
  "PENDING",         // Invitation sent, awaiting response
  "VIEWED",          // Sub has viewed the invitation
  "DECLINED",        // Sub declined to bid
  "RESPONDED",       // Sub submitted a quote
  "WITHDRAWN"        // Sub withdrew their response
]);

export const bidResponseStatusEnum = pgEnum("bid_response_status", [
  "DRAFT",           // Sub is preparing response
  "SUBMITTED",       // Response submitted
  "UNDER_REVIEW",    // GC is reviewing
  "SHORTLISTED",     // GC marked as potential winner
  "AWARDED",         // Sub won the bid
  "NOT_SELECTED",    // Sub not selected
  "WITHDRAWN"        // Sub withdrew response
]);

// Organization Network Settings - Admin toggles for bid network participation
export const organizationNetworkSettings = pgTable("organization_network_settings", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }).unique(),
  
  // Master toggles
  isNetworkEnabled: boolean("is_network_enabled").notNull().default(true),           // Overall participation in network
  canReceiveBidInvites: boolean("can_receive_bid_invites").notNull().default(true),  // Receive invites from other orgs
  canSendBidRequests: boolean("can_send_bid_requests").notNull().default(true),      // Send invites to other orgs
  
  // Trade specialties (for matching) - array of trade types this org performs
  tradeSpecialties: text("trade_specialties").array(),  // Store as array of trade type strings
  
  // Preferences
  autoAcceptFromTrustedGCs: boolean("auto_accept_from_trusted_gcs").notNull().default(false),
  trustedGCOrganizationIds: text("trusted_gc_organization_ids").array(),
  maxActiveInvites: integer("max_active_invites").default(50),
  notifyByEmail: boolean("notify_by_email").notNull().default(true),
  notifyInApp: boolean("notify_in_app").notNull().default(true),
  
  // Profile info visible to network
  companyDescription: text("company_description"),
  serviceAreas: text("service_areas").array(),  // Geographic regions served
  certifications: text("certifications").array(),
  yearsInBusiness: integer("years_in_business"),
  
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  orgIdx: index("org_network_settings_org_idx").on(table.organizationId),
}));

export const insertOrganizationNetworkSettingsSchema = createInsertSchema(organizationNetworkSettings).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertOrganizationNetworkSettings = z.infer<typeof insertOrganizationNetworkSettingsSchema>;
export type OrganizationNetworkSettings = typeof organizationNetworkSettings.$inferSelect;

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

// Dashboard Widget Configuration Type (for layout JSON)
export interface DashboardWidgetConfig {
  id: string;
  type: string;
  x: number;
  y: number;
  w: number;
  h: number;
  visible: boolean;
  minW?: number;
  minH?: number;
  maxW?: number;
  maxH?: number;
}

export interface DashboardLayoutConfig {
  widgets: DashboardWidgetConfig[];
  gridCols: number;
  version: number;
}

// Color palette validation result type
export interface ColorContrastResult {
  isValid: boolean;
  contrastRatio: number;
  wcagLevel: "AAA" | "AA" | "FAIL";
  pair: string;
}

export interface PaletteValidationResult {
  isValid: boolean;
  results: ColorContrastResult[];
  failedPairs: string[];
}
