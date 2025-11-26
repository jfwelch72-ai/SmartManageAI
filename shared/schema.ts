import { sql } from "drizzle-orm";
import { pgTable, text, varchar, boolean, timestamp, date, decimal, integer, pgEnum, doublePrecision, index, unique } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod";

// Enums
export const userRoleEnum = pgEnum("user_role", ["ADMIN", "MANAGER", "SUPERINTENDENT", "ESTIMATOR", "OFFICE_MANAGER", "HOURLY_EMPLOYEE"]);
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
export const notificationTypeEnum = pgEnum("notification_type", ["BILLING_READY", "CHANGE_ORDER_PENDING", "TIME_OFF_REQUEST", "GENERAL"]);
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

// CRM Enums
export const crmOrganisationTypeEnum = pgEnum("crm_organisation_type", ["CONTRACTOR", "SUBCONTRACTOR", "SUPPLIER", "VENDOR", "OWNER_REP"]);
export const crmContactRoleEnum = pgEnum("crm_contact_role", ["PM", "ESTIMATOR", "SUPERINTENDENT", "SALES", "ACCOUNTS_PAYABLE", "ACCOUNTS_RECEIVABLE", "OWNER", "GENERAL_MANAGER", "FOREMAN", "OTHER"]);
export const crmPreferredContactEnum = pgEnum("crm_preferred_contact", ["EMAIL", "PHONE", "TEXT", "OTHER"]);
export const crmNoteTypeEnum = pgEnum("crm_note_type", ["CALL", "EMAIL", "MEETING", "HOT_LEAD", "COLD_LEAD", "FOLLOW_UP", "ISSUE", "GENERAL"]);

// Users table
export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
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
  approvedById: varchar("approved_by_id").references(() => users.id),
  approvedAt: timestamp("approved_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  userIdIdx: index("time_entries_user_id_idx").on(table.userId),
  projectIdIdx: index("time_entries_project_id_idx").on(table.projectId),
  dateIdx: index("time_entries_date_idx").on(table.date),
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
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  projectUserUnique: unique().on(table.projectId, table.userId),
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

// Manual Tasks table (user-created tasks separate from AI insights)
export const tasks = pgTable("tasks", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: varchar("project_id").references(() => projects.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  description: text("description"),
  category: aiNoteInsightCategoryEnum("category").notNull().default("OTHER"),
  priority: aiTaskPriorityEnum("priority").notNull().default("MEDIUM"),
  status: aiTaskStatusEnum("status").notNull().default("PENDING"),
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
  projectIdIdx: index("tasks_project_id_idx").on(table.projectId),
  assignedToIdIdx: index("tasks_assigned_to_id_idx").on(table.assignedToId),
  statusIdx: index("tasks_status_idx").on(table.status),
  priorityIdx: index("tasks_priority_idx").on(table.priority),
  dueDateIdx: index("tasks_due_date_idx").on(table.dueDate),
}));

export const insertTaskSchema = createInsertSchema(tasks).omit({ id: true, createdAt: true, updatedAt: true });
export const updateTaskSchema = insertTaskSchema.partial();
export type Task = typeof tasks.$inferSelect;
export type InsertTask = z.infer<typeof insertTaskSchema>;

// Scope of Work Items table
export const scopeItems = pgTable("scope_items", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  estimateLineItemId: varchar("estimate_line_item_id").references(() => estimateLineItems.id, { onDelete: "set null" }),
  description: text("description").notNull(),
  unit: text("unit").notNull(),
  totalQuantity: decimal("total_quantity", { precision: 12, scale: 2 }).notNull(),
  completedQuantity: decimal("completed_quantity", { precision: 12, scale: 2 }).notNull().default("0"),
  billedQuantity: decimal("billed_quantity", { precision: 12, scale: 2 }).notNull().default("0"),
  unitPrice: decimal("unit_price", { precision: 10, scale: 2 }),
  billingStatus: billingStatusEnum("billing_status").notNull().default("NOT_READY"),
  lastBilledDate: timestamp("last_billed_date"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  // Enforce one-to-one mapping: one scope item per estimate line item
  uniqueEstimateLineItem: unique("scope_items_estimate_line_item_unique").on(table.estimateLineItemId),
}));

// Daily Scope Progress table - tracks daily quantities completed for each scope item
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
  createdById: varchar("created_by_id").notNull().references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  scopeItemIdIdx: index("daily_scope_progress_scope_item_id_idx").on(table.scopeItemId),
  projectIdIdx: index("daily_scope_progress_project_id_idx").on(table.projectId),
  workDateIdx: index("daily_scope_progress_work_date_idx").on(table.workDate),
  billingStatusIdx: index("daily_scope_progress_billing_status_idx").on(table.billingStatus),
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
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  statusIdx: index("change_orders_status_idx").on(table.status),
  projectIdIdx: index("change_orders_project_id_idx").on(table.projectId),
}));

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
  computedQuantity: decimal("computed_quantity", { precision: 12, scale: 2 }),
  materialCost: decimal("material_cost", { precision: 12, scale: 2 }).notNull().default('0'),
  laborHours: decimal("labor_hours", { precision: 10, scale: 2 }).notNull().default('0'),
  laborCost: decimal("labor_cost", { precision: 12, scale: 2 }).notNull().default('0'),
  equipmentHours: decimal("equipment_hours", { precision: 10, scale: 2 }).notNull().default('0'),
  equipmentCost: decimal("equipment_cost", { precision: 12, scale: 2 }).notNull().default('0'),
  consumablesCost: decimal("consumables_cost", { precision: 12, scale: 2 }).notNull().default('0'),
  subcontractCost: decimal("subcontract_cost", { precision: 12, scale: 2 }).notNull().default('0'),
  overheadAllocation: decimal("overhead_allocation", { precision: 12, scale: 2 }).notNull().default('0'),
  profitAllocation: decimal("profit_allocation", { precision: 12, scale: 2 }).notNull().default('0'),
  totalCost: decimal("total_cost", { precision: 12, scale: 2 }).notNull(),
  userAdjusted: boolean("user_adjusted").notNull().default(false),
  metadata: text("metadata"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  estimateIdx: index("estimate_line_items_estimate_idx").on(table.estimateId),
  categoryIdx: index("estimate_line_items_category_idx").on(table.category),
  sourceIdx: index("estimate_line_items_source_idx").on(table.source),
  scopeWorkTypeIdx: index("estimate_line_items_scope_work_type_idx").on(table.scopeWorkTypeId),
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

export type InsertCalendarEvent = z.infer<typeof insertCalendarEventSchema>;
export type CalendarEvent = typeof calendarEvents.$inferSelect;

export type InsertNotification = z.infer<typeof insertNotificationSchema>;
export type Notification = typeof notifications.$inferSelect;

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

// Equipment table
export const equipment = pgTable("equipment", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  type: text("type").notNull(),
  serialNumber: text("serial_number"),
  status: text("status").notNull().default("AVAILABLE"),
  assignedToCrewId: varchar("assigned_to_crew_id").references(() => crews.id),
  assignedToProjectId: varchar("assigned_to_project_id").references(() => projects.id),
  purchaseDate: timestamp("purchase_date"),
  lastMaintenanceDate: timestamp("last_maintenance_date"),
  nextMaintenanceDate: timestamp("next_maintenance_date"),
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertEquipmentSchema = createInsertSchema(equipment).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertEquipment = z.infer<typeof insertEquipmentSchema>;
export type Equipment = typeof equipment.$inferSelect;

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

// Subcontractor Payments table
export const subcontractorPayments = pgTable("subcontractor_payments", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  contractId: varchar("contract_id").notNull().references(() => subcontractorContracts.id, { onDelete: "cascade" }),
  paymentNumber: integer("payment_number").notNull(),
  amount: decimal("amount", { precision: 12, scale: 2 }).notNull(),
  retentionHeld: decimal("retention_held", { precision: 12, scale: 2 }),
  paymentDate: timestamp("payment_date"),
  description: text("description"),
  invoiceNumber: text("invoice_number"),
  status: text("status").notNull().default("PENDING"),
  approvedById: varchar("approved_by_id").references(() => users.id),
  approvedAt: timestamp("approved_at"),
  paidById: varchar("paid_by_id").references(() => users.id),
  paidAt: timestamp("paid_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertSubcontractorPaymentSchema = createInsertSchema(subcontractorPayments).omit({ id: true, createdAt: true });
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
  typeIdx: index("crm_organisations_type_idx").on(table.type),
  nameIdx: index("crm_organisations_name_idx").on(table.name),
}));

export const insertCrmOrganisationSchema = createInsertSchema(crmOrganisations).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertCrmOrganisation = z.infer<typeof insertCrmOrganisationSchema>;
export type CrmOrganisation = typeof crmOrganisations.$inferSelect;

// CRM Contacts table - People associated with organisations
export const crmContacts = pgTable("crm_contacts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
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
  organisationIdx: index("crm_contacts_organisation_idx").on(table.organisationId),
}));

export const insertCrmContactSchema = createInsertSchema(crmContacts).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertCrmContact = z.infer<typeof insertCrmContactSchema>;
export type CrmContact = typeof crmContacts.$inferSelect;

// CRM Organisation Notes table - Activity log for tracking interactions
// Auto-timestamps to track when managers contact organizations/people
export const crmOrganisationNotes = pgTable("crm_organisation_notes", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organisationId: varchar("organisation_id").notNull().references(() => crmOrganisations.id, { onDelete: "cascade" }),
  contactId: varchar("contact_id").references(() => crmContacts.id, { onDelete: "set null" }), // Optional: link to specific contact
  noteType: crmNoteTypeEnum("note_type").notNull().default("GENERAL"),
  content: text("content").notNull(),
  createdById: varchar("created_by_id").references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
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
