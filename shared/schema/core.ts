import { sql } from "drizzle-orm";
import { pgTable, text, varchar, boolean, timestamp, date, decimal, integer, pgEnum, doublePrecision, index, unique, json } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod";
import { addonKeyEnum, addonStatusEnum, bidStatusEnum, billingProviderEnum, onboardingStatusEnum, payRunStatusEnum, planTierEnum, projectStatusEnum, subscriptionStatusEnum, tradeTypeEnum, usageKeyEnum, userRoleEnum, workWeekStartDayEnum } from "./enums";

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
  featureFlags: text("feature_flags"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertOrganizationSchema = createInsertSchema(organizations).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertOrganization = z.infer<typeof insertOrganizationSchema>;
export type Organization = typeof organizations.$inferSelect;

// Organization Subscriptions table
export const organizationSubscriptions = pgTable("organization_subscriptions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }).unique(),
  planTier: planTierEnum("plan_tier").notNull().default("free"),
  status: subscriptionStatusEnum("status").notNull().default("active"),
  billingProvider: billingProviderEnum("billing_provider").notNull().default("manual"),
  stripeCustomerId: text("stripe_customer_id"),
  stripeSubscriptionId: text("stripe_subscription_id"),
  currentPeriodEnd: timestamp("current_period_end"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  orgIdIdx: index("org_subscriptions_org_id_idx").on(table.organizationId),
}));

export const insertOrganizationSubscriptionSchema = createInsertSchema(organizationSubscriptions).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertOrganizationSubscription = z.infer<typeof insertOrganizationSubscriptionSchema>;
export type OrganizationSubscription = typeof organizationSubscriptions.$inferSelect;

// Organization Add-ons table
export const organizationAddOns = pgTable("organization_addons", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  addonKey: addonKeyEnum("addon_key").notNull(),
  status: addonStatusEnum("status").notNull().default("inactive"),
  stripePriceId: text("stripe_price_id"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  orgIdIdx: index("org_addons_org_id_idx").on(table.organizationId),
  orgAddonUniqueIdx: unique("org_addon_unique").on(table.organizationId, table.addonKey),
}));

export const insertOrganizationAddOnSchema = createInsertSchema(organizationAddOns).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertOrganizationAddOn = z.infer<typeof insertOrganizationAddOnSchema>;
export type OrganizationAddOn = typeof organizationAddOns.$inferSelect;

// Organization Usage table (for usage-based features like AI Vision)
export const organizationUsage = pgTable("organization_usage", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  usageKey: usageKeyEnum("usage_key").notNull(),
  periodStart: timestamp("period_start").notNull(),
  periodEnd: timestamp("period_end").notNull(),
  quantity: integer("quantity").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  orgIdIdx: index("org_usage_org_id_idx").on(table.organizationId),
  periodIdx: index("org_usage_period_idx").on(table.periodStart, table.periodEnd),
}));

export const insertOrganizationUsageSchema = createInsertSchema(organizationUsage).omit({ id: true, createdAt: true });
export type InsertOrganizationUsage = z.infer<typeof insertOrganizationUsageSchema>;
export type OrganizationUsage = typeof organizationUsage.$inferSelect;

export const subscriptionEvents = pgTable("subscription_events", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  eventType: text("event_type").notNull(),
  previousValue: text("previous_value"),
  newValue: text("new_value"),
  description: text("description").notNull(),
  performedBy: varchar("performed_by").references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  orgIdIdx: index("subscription_events_org_id_idx").on(table.organizationId),
  eventTypeIdx: index("subscription_events_event_type_idx").on(table.eventType),
  createdAtIdx: index("subscription_events_created_at_idx").on(table.createdAt),
}));

export const insertSubscriptionEventSchema = createInsertSchema(subscriptionEvents).omit({ id: true, createdAt: true });
export type InsertSubscriptionEvent = z.infer<typeof insertSubscriptionEventSchema>;
export type SubscriptionEvent = typeof subscriptionEvents.$inferSelect;

// Work Week Start Day Enum (0=Sunday, 1=Monday, etc.)
export const organizationPayrollSettings = pgTable("organization_payroll_settings", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }).unique(),
  workWeekStartDay: workWeekStartDayEnum("work_week_start_day").notNull().default("MONDAY"),
  workWeekEndNotificationEnabled: boolean("work_week_end_notification_enabled").notNull().default(true),
  notificationRecipientEmails: text("notification_recipient_emails"),
  overtimeThresholdHours: decimal("overtime_threshold_hours", { precision: 5, scale: 2 }).notNull().default("40"),
  autoGenerateWeeklyReports: boolean("auto_generate_weekly_reports").notNull().default(true),
  requireSuperintendentApproval: boolean("require_superintendent_approval").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  orgIdIdx: index("org_payroll_settings_org_id_idx").on(table.organizationId),
}));

export const insertOrganizationPayrollSettingsSchema = createInsertSchema(organizationPayrollSettings).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertOrganizationPayrollSettings = z.infer<typeof insertOrganizationPayrollSettingsSchema>;
export type OrganizationPayrollSettings = typeof organizationPayrollSettings.$inferSelect;

// Weekly Payroll Reports table - stores generated end-of-week reports
export const weeklyPayrollReports = pgTable("weekly_payroll_reports", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  weekStartDate: date("week_start_date").notNull(),
  weekEndDate: date("week_end_date").notNull(),
  totalRegularHours: decimal("total_regular_hours", { precision: 10, scale: 2 }).notNull().default("0"),
  totalOvertimeHours: decimal("total_overtime_hours", { precision: 10, scale: 2 }).notNull().default("0"),
  totalEmployees: integer("total_employees").notNull().default(0),
  reportData: text("report_data"),
  generatedAt: timestamp("generated_at").notNull().defaultNow(),
  generatedByApprovalOf: varchar("generated_by_approval_of").references(() => users.id),
  notificationSentAt: timestamp("notification_sent_at"),
  notificationRecipients: text("notification_recipients"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  orgIdIdx: index("weekly_payroll_reports_org_id_idx").on(table.organizationId),
  weekIdx: index("weekly_payroll_reports_week_idx").on(table.weekStartDate, table.weekEndDate),
  orgWeekUnique: unique("weekly_payroll_reports_org_week_unique").on(table.organizationId, table.weekStartDate),
}));

export const insertWeeklyPayrollReportSchema = createInsertSchema(weeklyPayrollReports).omit({ id: true, createdAt: true });
export type InsertWeeklyPayrollReport = z.infer<typeof insertWeeklyPayrollReportSchema>;
export type WeeklyPayrollReport = typeof weeklyPayrollReports.$inferSelect;

export const payRuns = pgTable("pay_runs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  payPeriodStart: date("pay_period_start").notNull(),
  payPeriodEnd: date("pay_period_end").notNull(),
  runNumber: text("run_number"),
  status: payRunStatusEnum("status").notNull().default("DRAFT"),
  totalRegularHours: decimal("total_regular_hours", { precision: 10, scale: 2 }).notNull().default("0"),
  totalOvertimeHours: decimal("total_overtime_hours", { precision: 10, scale: 2 }).notNull().default("0"),
  totalLaborCost: decimal("total_labor_cost", { precision: 12, scale: 2 }).notNull().default("0"),
  totalWorkers: integer("total_workers").notNull().default(0),
  notes: text("notes"),
  createdById: varchar("created_by_id").notNull().references(() => users.id),
  approvedById: varchar("approved_by_id").references(() => users.id),
  approvedAt: timestamp("approved_at"),
  paidAt: timestamp("paid_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  orgIdx: index("pay_runs_org_idx").on(table.organizationId),
  statusIdx: index("pay_runs_status_idx").on(table.status),
  periodIdx: index("pay_runs_period_idx").on(table.payPeriodStart, table.payPeriodEnd),
}));

export const insertPayRunSchema = createInsertSchema(payRuns).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertPayRun = z.infer<typeof insertPayRunSchema>;
export type PayRun = typeof payRuns.$inferSelect;

export const payRunLineItems = pgTable("pay_run_line_items", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  payRunId: varchar("pay_run_id").notNull().references(() => payRuns.id, { onDelete: "cascade" }),
  userId: varchar("user_id").notNull().references(() => users.id),
  projectId: varchar("project_id").notNull().references(() => projects.id),
  costCode: text("cost_code"),
  regularHours: decimal("regular_hours", { precision: 8, scale: 2 }).notNull().default("0"),
  overtimeHours: decimal("overtime_hours", { precision: 8, scale: 2 }).notNull().default("0"),
  regularRate: decimal("regular_rate", { precision: 10, scale: 2 }).notNull().default("0"),
  overtimeRate: decimal("overtime_rate", { precision: 10, scale: 2 }).notNull().default("0"),
  totalAmount: decimal("total_amount", { precision: 12, scale: 2 }).notNull().default("0"),
  timeEntryIds: text("time_entry_ids").array(),
  wageType: text("wage_type").default("STANDARD"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  payRunIdx: index("pay_run_line_items_pay_run_idx").on(table.payRunId),
  userIdx: index("pay_run_line_items_user_idx").on(table.userId),
  projectIdx: index("pay_run_line_items_project_idx").on(table.projectId),
}));

export const insertPayRunLineItemSchema = createInsertSchema(payRunLineItems).omit({ id: true, createdAt: true });
export type InsertPayRunLineItem = z.infer<typeof insertPayRunLineItemSchema>;
export type PayRunLineItem = typeof payRunLineItems.$inferSelect;

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
  passwordHash: text("password_hash"),
  tokenVersion: integer("token_version").notNull().default(0),
  emailVerified: boolean("email_verified").notNull().default(false),
  failedLoginAttempts: integer("failed_login_attempts").notNull().default(0),
  lockedUntil: timestamp("locked_until"),
  oauthProvider: text("oauth_provider"),
  oauthProviderId: text("oauth_provider_id"),
  costRateRegular: decimal("cost_rate_regular", { precision: 10, scale: 2 }),
  costRateOvertime: decimal("cost_rate_overtime", { precision: 10, scale: 2 }),
  birthdate: text("birthdate"),
  timezone: text("timezone"),
  profileDescription: text("profile_description"),
  avatarUrl: text("avatar_url"),
  tradeSpecialization: text("trade_specialization"),
  employmentType: text("employment_type"),
  emergencyContactName: text("emergency_contact_name"),
  emergencyContactPhone: text("emergency_contact_phone"),
  emergencyContactAddress: text("emergency_contact_address"),
  emergencyContactEmail: text("emergency_contact_email"),
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
  siteLatitude: doublePrecision("site_latitude"),
  siteLongitude: doublePrecision("site_longitude"),
  geofenceRadius: integer("geofence_radius"),
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
  status: bidStatusEnum("status").notNull().default("DRAFT"),
  convertedToProjectId: varchar("converted_to_project_id"),
  awardedAt: timestamp("awarded_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Bid Subcontractor Quotes table
// During conversion: projectId added, bidId set to null when bid deleted
// Non-selected quotes preserved for later selection on project page
export const insertUserSchema = createInsertSchema(users).omit({
  id: true,
  tokenVersion: true,
  createdAt: true,
  updatedAt: true,
});

// Password Reset Tokens table
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

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;
export type InsertProject = z.infer<typeof insertProjectSchema>;
export type Project = typeof projects.$inferSelect;

export type InsertBid = z.infer<typeof insertBidSchema>;
export type Bid = typeof bids.$inferSelect;

