import { sql } from "drizzle-orm";
import { pgTable, varchar, text, integer, boolean, timestamp, jsonb, index, uniqueIndex, decimal } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { organizations, users } from "./core";
import {
  crmLeadFormStatusEnum,
  crmMeetingBookingStatusEnum,
  crmAutomationTriggerEnum,
  crmCsvImportEntityEnum,
  crmCsvImportStatusEnum,
  crmPipelineStageEnum,
} from "./enums";
import { crmContacts, crmOrganisations, crmOpportunities } from "./features";

// ============================================
// LEAD FORM BUILDER
// ============================================
export const crmLeadForms = pgTable("crm_lead_forms", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  slug: text("slug").notNull(),
  status: crmLeadFormStatusEnum("status").notNull().default("DRAFT"),
  fields: jsonb("fields").notNull().default([]),
  successMessage: text("success_message").notNull().default("Thanks! We'll be in touch shortly."),
  notifyUserIds: text("notify_user_ids").array().notNull().default(sql`ARRAY[]::text[]`),
  createOpportunity: boolean("create_opportunity").notNull().default(true),
  defaultStage: crmPipelineStageEnum("default_stage").notNull().default("LEAD"),
  defaultSource: text("default_source").default("Web Form"),
  createdById: varchar("created_by_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  orgIdx: index("crm_lead_forms_org_idx").on(table.organizationId),
  slugIdx: uniqueIndex("crm_lead_forms_slug_uniq").on(table.slug),
}));
export const insertCrmLeadFormSchema = createInsertSchema(crmLeadForms).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertCrmLeadForm = z.infer<typeof insertCrmLeadFormSchema>;
export type CrmLeadForm = typeof crmLeadForms.$inferSelect;

export const crmLeadFormSubmissions = pgTable("crm_lead_form_submissions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  formId: varchar("form_id").notNull().references(() => crmLeadForms.id, { onDelete: "cascade" }),
  payload: jsonb("payload").notNull().default({}),
  contactId: varchar("contact_id").references(() => crmContacts.id, { onDelete: "set null" }),
  opportunityId: varchar("opportunity_id").references(() => crmOpportunities.id, { onDelete: "set null" }),
  remoteIp: text("remote_ip"),
  userAgent: text("user_agent"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  orgIdx: index("crm_lead_form_subs_org_idx").on(table.organizationId),
  formIdx: index("crm_lead_form_subs_form_idx").on(table.formId),
  createdIdx: index("crm_lead_form_subs_created_idx").on(table.createdAt),
}));
export const insertCrmLeadFormSubmissionSchema = createInsertSchema(crmLeadFormSubmissions).omit({ id: true, createdAt: true });
export type InsertCrmLeadFormSubmission = z.infer<typeof insertCrmLeadFormSubmissionSchema>;
export type CrmLeadFormSubmission = typeof crmLeadFormSubmissions.$inferSelect;

// ============================================
// MEETING BOOKING LINKS
// ============================================
export const crmMeetingLinks = pgTable("crm_meeting_links", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  ownerUserId: varchar("owner_user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  slug: text("slug").notNull(),
  name: text("name").notNull(),
  description: text("description"),
  durationMinutes: integer("duration_minutes").notNull().default(30),
  bufferMinutes: integer("buffer_minutes").notNull().default(0),
  // availability: { mon: [{start: "09:00", end: "17:00"}], tue: [...], ... }
  availability: jsonb("availability").notNull().default({}),
  timezone: text("timezone").notNull().default("America/New_York"),
  isActive: boolean("is_active").notNull().default(true),
  notifyOnBooking: boolean("notify_on_booking").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  orgIdx: index("crm_meeting_links_org_idx").on(table.organizationId),
  ownerIdx: index("crm_meeting_links_owner_idx").on(table.ownerUserId),
  slugIdx: uniqueIndex("crm_meeting_links_slug_uniq").on(table.slug),
}));
export const insertCrmMeetingLinkSchema = createInsertSchema(crmMeetingLinks).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertCrmMeetingLink = z.infer<typeof insertCrmMeetingLinkSchema>;
export type CrmMeetingLink = typeof crmMeetingLinks.$inferSelect;

export const crmMeetingBookings = pgTable("crm_meeting_bookings", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  linkId: varchar("link_id").notNull().references(() => crmMeetingLinks.id, { onDelete: "cascade" }),
  ownerUserId: varchar("owner_user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  inviteeName: text("invitee_name").notNull(),
  inviteeEmail: text("invitee_email").notNull(),
  inviteePhone: text("invitee_phone"),
  notes: text("notes"),
  startAt: timestamp("start_at").notNull(),
  endAt: timestamp("end_at").notNull(),
  status: crmMeetingBookingStatusEnum("status").notNull().default("SCHEDULED"),
  contactId: varchar("contact_id").references(() => crmContacts.id, { onDelete: "set null" }),
  opportunityId: varchar("opportunity_id").references(() => crmOpportunities.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  orgIdx: index("crm_meeting_bookings_org_idx").on(table.organizationId),
  ownerIdx: index("crm_meeting_bookings_owner_idx").on(table.ownerUserId),
  startIdx: index("crm_meeting_bookings_start_idx").on(table.startAt),
  uniqSlot: uniqueIndex("crm_meeting_bookings_owner_start_uniq").on(table.ownerUserId, table.startAt),
}));
export const insertCrmMeetingBookingSchema = createInsertSchema(crmMeetingBookings).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertCrmMeetingBooking = z.infer<typeof insertCrmMeetingBookingSchema>;
export type CrmMeetingBooking = typeof crmMeetingBookings.$inferSelect;

// ============================================
// SLA CONFIG (per stage)
// ============================================
export const crmStageSlas = pgTable("crm_stage_slas", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  stage: crmPipelineStageEnum("stage").notNull(),
  maxDaysInStage: integer("max_days_in_stage").notNull().default(7),
  warnAtDays: integer("warn_at_days").notNull().default(5),
  notifyAssignee: boolean("notify_assignee").notNull().default(true),
  notifyManager: boolean("notify_manager").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  orgStageIdx: uniqueIndex("crm_stage_slas_org_stage_uniq").on(table.organizationId, table.stage),
}));
export const insertCrmStageSlaSchema = createInsertSchema(crmStageSlas).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertCrmStageSla = z.infer<typeof insertCrmStageSlaSchema>;
export type CrmStageSla = typeof crmStageSlas.$inferSelect;

// ============================================
// AUTOMATION BUILDER
// ============================================
export const crmAutomations = pgTable("crm_automations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description"),
  isActive: boolean("is_active").notNull().default(true),
  trigger: crmAutomationTriggerEnum("trigger").notNull(),
  // triggerConfig: { fromStage?: string, toStage?: string, idleDays?: number, scoreMin?: number, formId?: string, fieldName?: string }
  triggerConfig: jsonb("trigger_config").notNull().default({}),
  // actions: [{ type: "ASSIGN"|"NOTIFY"|"CREATE_TASK"|"ENROLL_SEQUENCE"|"UPDATE_FIELD"|"WEBHOOK"|"SEND_SMS", config: {...} }]
  actions: jsonb("actions").notNull().default([]),
  createdById: varchar("created_by_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  orgIdx: index("crm_automations_org_idx").on(table.organizationId),
  triggerIdx: index("crm_automations_trigger_idx").on(table.trigger),
}));
export const insertCrmAutomationSchema = createInsertSchema(crmAutomations).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertCrmAutomation = z.infer<typeof insertCrmAutomationSchema>;
export type CrmAutomation = typeof crmAutomations.$inferSelect;

export const crmAutomationRuns = pgTable("crm_automation_runs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  automationId: varchar("automation_id").notNull().references(() => crmAutomations.id, { onDelete: "cascade" }),
  entityType: text("entity_type").notNull(),
  entityId: varchar("entity_id").notNull(),
  status: text("status").notNull().default("SUCCESS"),
  details: jsonb("details").notNull().default({}),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  orgIdx: index("crm_automation_runs_org_idx").on(table.organizationId),
  automationIdx: index("crm_automation_runs_automation_idx").on(table.automationId),
  entityIdx: index("crm_automation_runs_entity_idx").on(table.entityType, table.entityId),
}));
export const insertCrmAutomationRunSchema = createInsertSchema(crmAutomationRuns).omit({ id: true, createdAt: true });
export type InsertCrmAutomationRun = z.infer<typeof insertCrmAutomationRunSchema>;
export type CrmAutomationRun = typeof crmAutomationRuns.$inferSelect;

// ============================================
// CSV IMPORT JOBS
// ============================================
export const crmCsvImportJobs = pgTable("crm_csv_import_jobs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  entityType: crmCsvImportEntityEnum("entity_type").notNull(),
  status: crmCsvImportStatusEnum("status").notNull().default("PENDING"),
  filename: text("filename"),
  totalRows: integer("total_rows").notNull().default(0),
  processedRows: integer("processed_rows").notNull().default(0),
  insertedRows: integer("inserted_rows").notNull().default(0),
  updatedRows: integer("updated_rows").notNull().default(0),
  skippedRows: integer("skipped_rows").notNull().default(0),
  errorRows: integer("error_rows").notNull().default(0),
  // mapping: { csvColumn: "schemaField" }
  mapping: jsonb("mapping").notNull().default({}),
  // payload: array of raw csv rows queued for processing (cleared once processed)
  payload: jsonb("payload").notNull().default([]),
  errors: jsonb("errors").notNull().default([]),
  startedAt: timestamp("started_at"),
  insertedIds: text("inserted_ids").array().notNull().default(sql`ARRAY[]::text[]`),
  createdById: varchar("created_by_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  completedAt: timestamp("completed_at"),
}, (table) => ({
  orgIdx: index("crm_csv_import_jobs_org_idx").on(table.organizationId),
  statusIdx: index("crm_csv_import_jobs_status_idx").on(table.status),
}));
export const insertCrmCsvImportJobSchema = createInsertSchema(crmCsvImportJobs).omit({ id: true, createdAt: true });
export type InsertCrmCsvImportJob = z.infer<typeof insertCrmCsvImportJobSchema>;
export type CrmCsvImportJob = typeof crmCsvImportJobs.$inferSelect;

// ============================================
// CUSTOM REPORT BUILDER
// ============================================
export const crmCustomReports = pgTable("crm_custom_reports", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description"),
  // config: { entity: "opportunity"|"contact", dimensions: [...], measures: [...], filters: [...], chart: "bar"|"line"|"table" }
  config: jsonb("config").notNull().default({}),
  isShared: boolean("is_shared").notNull().default(false),
  createdById: varchar("created_by_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  orgIdx: index("crm_custom_reports_org_idx").on(table.organizationId),
}));
export const insertCrmCustomReportSchema = createInsertSchema(crmCustomReports).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertCrmCustomReport = z.infer<typeof insertCrmCustomReportSchema>;
export type CrmCustomReport = typeof crmCustomReports.$inferSelect;
