import { sql } from "drizzle-orm";
import { pgTable, text, varchar, boolean, timestamp, date, decimal, integer, pgEnum, doublePrecision, index, unique, json } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod";
import { addonKeyEnum, addonStatusEnum, alertFailureEmailModeEnum, backfillSummaryChannelEnum, bidStatusEnum, billingProviderEnum, deductionCalculationMethodEnum, deductionCategoryEnum, geofenceEnforcementEnum, jobMetricAlertQuietHoursDigestFormatEnum, jobMetricAlertQuietHoursDigestTimeFormatEnum, onboardingStatusEnum, payRunStatusEnum, payrollFormVariantEnum, planTierEnum, projectStatusEnum, subscriptionStatusEnum, tradeTypeEnum, usageKeyEnum, userRoleEnum, workWeekStartDayEnum } from "./enums";

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
  matchTolerancePct: decimal("match_tolerance_pct", { precision: 5, scale: 2 }).default("5"),
  isActive: boolean("is_active").notNull().default(true),
  hiringAutoTasksEnabled: boolean("hiring_auto_tasks_enabled").notNull().default(false),
  annualRevenueTarget: decimal("annual_revenue_target", { precision: 15, scale: 2 }),
  defaultOverheadPercent: decimal("default_overhead_percent", { precision: 8, scale: 4 }).default("15"),
  overheadWarningThreshold: decimal("overhead_warning_threshold", { precision: 8, scale: 4 }),
  overheadCriticalThreshold: decimal("overhead_critical_threshold", { precision: 8, scale: 4 }),
  overheadCategoryWeights: text("overhead_category_weights"),
  monthlyRevenueTargets: text("monthly_revenue_targets"),
  peerRatingAnonymityMode: text("peer_rating_anonymity_mode").notNull().default("fully_anonymous"),
  peerRatingScopeMode: text("peer_rating_scope_mode").notNull().default("project_crew"),
  // Task #1286: per-org escalation policy for the nightly SWPPP overdue
  // corrective-action sweep (see `processSwpppOverdueCorrectiveActions`
  // in server/jobs/jobRunner.ts). Defaults match the previous hard-coded
  // constants (cap of 5 follow-up reminders, ~daily cadence at 22h) so
  // upgrading is a no-op for existing orgs. Admins can dial these up or
  // down per organization without touching env vars or shipping code.
  swpppOverdueReminderMaxCount: integer("swppp_overdue_reminder_max_count").notNull().default(5),
  swpppOverdueReminderIntervalHours: integer("swppp_overdue_reminder_interval_hours").notNull().default(22),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const SWPPP_OVERDUE_REMINDER_DEFAULT_CAP = 5;
export const SWPPP_OVERDUE_REMINDER_DEFAULT_INTERVAL_HOURS = 22;
export const SWPPP_OVERDUE_REMINDER_MAX_CAP = 365;
export const SWPPP_OVERDUE_REMINDER_MIN_INTERVAL_HOURS = 1;
export const SWPPP_OVERDUE_REMINDER_MAX_INTERVAL_HOURS = 24 * 30;

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
  signerName: text("signer_name"),
  signerTitle: text("signer_title"),
  contractorAddress: text("contractor_address"),
  defaultFringeOption: text("default_fringe_option").notNull().default("PLAN"),
  // Task #1178: retention window (in days) after which archived certified
  // payroll PDFs are auto-purged by the nightly cleanup job. Default is
  // 1095 days (~3 years), matching Davis-Bacon record retention. Setting
  // to 0 disables the auto-purge for the org.
  archivedReportRetentionDays: integer("archived_report_retention_days").notNull().default(1095),
  // Task #1181: per-org schedule for the certified payroll digest job
  // (`processCertifiedPayrollWeeklyDigest`). Defaults preserve the original
  // hard-coded behavior of Monday 8am UTC weekly. Cadence options:
  //   OFF      → digest disabled for this org
  //   DAILY    → fire every day at the chosen local hour (window = last 24h)
  //   WEEKLY   → fire on the chosen weekday at the chosen local hour (window = 7d)
  //   BIWEEKLY → like WEEKLY but only fires when ≥13d since lastSentAt (window = 14d)
  certifiedPayrollDigestCadence: text("certified_payroll_digest_cadence").notNull().default("WEEKLY"),
  certifiedPayrollDigestWeekday: integer("certified_payroll_digest_weekday").notNull().default(1),
  certifiedPayrollDigestHour: integer("certified_payroll_digest_hour").notNull().default(8),
  certifiedPayrollDigestTimezone: text("certified_payroll_digest_timezone").notNull().default("UTC"),
  certifiedPayrollDigestLastSentAt: timestamp("certified_payroll_digest_last_sent_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  orgIdIdx: index("org_payroll_settings_org_id_idx").on(table.organizationId),
}));

export const CERTIFIED_PAYROLL_DIGEST_CADENCES = ["OFF", "DAILY", "WEEKLY", "BIWEEKLY"] as const;
export type CertifiedPayrollDigestCadence = typeof CERTIFIED_PAYROLL_DIGEST_CADENCES[number];

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

// Certified Payroll Reports - audit log of every generated WH-347/state DOT certified payroll PDF.
export const certifiedPayrollReports = pgTable("certified_payroll_reports", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  payRunId: varchar("pay_run_id").notNull().references(() => payRuns.id, { onDelete: "cascade" }),
  projectId: varchar("project_id").references(() => projects.id, { onDelete: "set null" }),
  variant: payrollFormVariantEnum("variant").notNull(),
  objectKey: text("object_key").notNull(),
  fileSize: integer("file_size").notNull().default(0),
  generatedById: varchar("generated_by_id").references(() => users.id),
  generatedAt: timestamp("generated_at").notNull().defaultNow(),
  archivedAt: timestamp("archived_at"),
  archivedById: varchar("archived_by_id").references(() => users.id),
  archiveReason: text("archive_reason"),
}, (table) => ({
  orgIdx: index("certified_payroll_reports_org_idx").on(table.organizationId),
  payRunIdx: index("certified_payroll_reports_pay_run_idx").on(table.payRunId),
  projectIdx: index("certified_payroll_reports_project_idx").on(table.projectId),
  generatedAtIdx: index("certified_payroll_reports_generated_at_idx").on(table.generatedAt),
  archivedAtIdx: index("certified_payroll_reports_archived_at_idx").on(table.archivedAt),
}));

export const insertCertifiedPayrollReportSchema = createInsertSchema(certifiedPayrollReports).omit({ id: true, generatedAt: true });
export type InsertCertifiedPayrollReport = z.infer<typeof insertCertifiedPayrollReportSchema>;
export type CertifiedPayrollReport = typeof certifiedPayrollReports.$inferSelect;

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
  totalGrossAmount: decimal("total_gross_amount", { precision: 12, scale: 2 }).notNull().default("0"),
  totalDeductions: decimal("total_deductions", { precision: 12, scale: 2 }).notNull().default("0"),
  totalNetAmount: decimal("total_net_amount", { precision: 12, scale: 2 }).notNull().default("0"),
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
  doubleTimeHours: decimal("double_time_hours", { precision: 8, scale: 2 }).notNull().default("0"),
  regularRate: decimal("regular_rate", { precision: 10, scale: 2 }).notNull().default("0"),
  overtimeRate: decimal("overtime_rate", { precision: 10, scale: 2 }).notNull().default("0"),
  doubleTimeRate: decimal("double_time_rate", { precision: 10, scale: 2 }).notNull().default("0"),
  totalAmount: decimal("total_amount", { precision: 12, scale: 2 }).notNull().default("0"),
  grossAmount: decimal("gross_amount", { precision: 12, scale: 2 }).notNull().default("0"),
  totalDeductions: decimal("total_deductions", { precision: 12, scale: 2 }).notNull().default("0"),
  netAmount: decimal("net_amount", { precision: 12, scale: 2 }).notNull().default("0"),
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

export const payrollDeductionTypes = pgTable("payroll_deduction_types", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  category: deductionCategoryEnum("category").notNull(),
  calculationMethod: deductionCalculationMethodEnum("calculation_method").notNull().default("FIXED_AMOUNT"),
  rate: decimal("rate", { precision: 8, scale: 4 }),
  amount: decimal("amount", { precision: 12, scale: 2 }),
  maxAnnualAmount: decimal("max_annual_amount", { precision: 12, scale: 2 }),
  isPreTax: boolean("is_pre_tax").notNull().default(false),
  isActive: boolean("is_active").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  orgIdx: index("payroll_deduction_types_org_idx").on(table.organizationId),
}));

export const insertPayrollDeductionTypeSchema = createInsertSchema(payrollDeductionTypes).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertPayrollDeductionType = z.infer<typeof insertPayrollDeductionTypeSchema>;
export type PayrollDeductionType = typeof payrollDeductionTypes.$inferSelect;

export const employeeDeductions = pgTable("employee_deductions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  deductionTypeId: varchar("deduction_type_id").notNull().references(() => payrollDeductionTypes.id, { onDelete: "cascade" }),
  overrideAmount: decimal("override_amount", { precision: 12, scale: 2 }),
  effectiveDate: date("effective_date").notNull(),
  endDate: date("end_date"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  orgIdx: index("employee_deductions_org_idx").on(table.organizationId),
  userIdx: index("employee_deductions_user_idx").on(table.userId),
  typeIdx: index("employee_deductions_type_idx").on(table.deductionTypeId),
}));

export const insertEmployeeDeductionSchema = createInsertSchema(employeeDeductions).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertEmployeeDeduction = z.infer<typeof insertEmployeeDeductionSchema>;
export type EmployeeDeduction = typeof employeeDeductions.$inferSelect;

export const payStubDeductions = pgTable("pay_stub_deductions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  payRunLineItemId: varchar("pay_run_line_item_id").notNull().references(() => payRunLineItems.id, { onDelete: "cascade" }),
  deductionTypeId: varchar("deduction_type_id").notNull().references(() => payrollDeductionTypes.id),
  amount: decimal("amount", { precision: 12, scale: 2 }).notNull().default("0"),
  ytdAmount: decimal("ytd_amount", { precision: 12, scale: 2 }).notNull().default("0"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  lineItemIdx: index("pay_stub_deductions_line_item_idx").on(table.payRunLineItemId),
  typeIdx: index("pay_stub_deductions_type_idx").on(table.deductionTypeId),
}));

export const insertPayStubDeductionSchema = createInsertSchema(payStubDeductions).omit({ id: true, createdAt: true });
export type InsertPayStubDeduction = z.infer<typeof insertPayStubDeductionSchema>;
export type PayStubDeduction = typeof payStubDeductions.$inferSelect;

// Users table
export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").references(() => organizations.id, { onDelete: "set null" }),
  // Task #887: optional reverse pointer to this user's people-manager (another user
  // in the same org). Used by the "My Work" team view (?team=direct-reports) so
  // managers see only their direct reports' work, not the whole org.
  managerId: varchar("manager_id"),
  firstName: text("first_name").notNull(),
  lastName: text("last_name").notNull(),
  email: text("email").notNull().unique(),
  phone: text("phone"),
  role: userRoleEnum("role").notNull().default("FIELD_WORKER"),
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
  roleLabel: text("role_label"),
  walkthroughCompleted: boolean("walkthrough_completed").notNull().default(false),
  walkthroughStep: integer("walkthrough_step").notNull().default(0),
  walkthroughStartedAt: timestamp("walkthrough_started_at"),
  // Task #740: per-user opt-out for escalated job-metric alert emails.
  // Defaults to true (opted in) so existing Super Admins keep receiving
  // alert emails until they explicitly silence them. Only consulted by
  // the job-metric alert engine — other notification channels (in-app)
  // are unaffected.
  receivesJobMetricAlertEmails: boolean("receives_job_metric_alert_emails").notNull().default(true),
  // Task #748: optional quiet-hours window for job-metric alert emails.
  // When `enabled` and the recipient's local time falls inside the
  // [start, end) window on one of the selected weekdays, the alert
  // engine skips the email but still fires the in-app notification.
  // Times are stored as "HH:MM" strings, weekdays as 0=Sunday…6=Saturday.
  // Empty/null weekdays array means "every day".
  jobMetricAlertQuietHoursEnabled: boolean("job_metric_alert_quiet_hours_enabled").notNull().default(false),
  jobMetricAlertQuietHoursStart: text("job_metric_alert_quiet_hours_start"),
  jobMetricAlertQuietHoursEnd: text("job_metric_alert_quiet_hours_end"),
  jobMetricAlertQuietHoursTimezone: text("job_metric_alert_quiet_hours_timezone"),
  jobMetricAlertQuietHoursWeekdays: integer("job_metric_alert_quiet_hours_weekdays").array(),
  // Task #754: opt-in (default on) to receive a once-per-window digest
  // email summarizing alerts that fired while the user was inside their
  // quiet-hours window. `lastDigestAt` tracks the high-water mark of
  // events that have already been included in a previous digest, so
  // each quiet window is summarized at most once after it ends.
  jobMetricAlertQuietHoursDigestEnabled: boolean("job_metric_alert_quiet_hours_digest_enabled").notNull().default(true),
  jobMetricAlertQuietHoursLastDigestAt: timestamp("job_metric_alert_quiet_hours_last_digest_at"),
  // Task #761: per-recipient detail level for the quiet-hours digest
  // email — "summary" (counts only), "full" (per-event list), or
  // "grouped" (events grouped by job). Defaults to "full" so existing
  // recipients see the same digest layout until they pick a new one.
  jobMetricAlertQuietHoursDigestFormat: jobMetricAlertQuietHoursDigestFormatEnum(
    "job_metric_alert_quiet_hours_digest_format",
  ).notNull().default("full"),
  // Task #764: opt-in CSV attachment for the quiet-hours digest. When
  // true, `sendJobMetricAlertQuietHoursDigests` attaches a CSV
  // (job, counter, kind, triggeredAt, message) listing every event
  // matched in the window, ignoring the in-email 100-event cap so
  // large windows are still complete.
  jobMetricAlertQuietHoursDigestCsvEnabled: boolean("job_metric_alert_quiet_hours_digest_csv_enabled").notNull().default(false),
  // Task #776: per-recipient cap on how many recent alerts the quiet-hours
  // digest email body — and the in-app preview — surface. Heavy-traffic
  // Super Admins dial this down to keep the catch-up email scannable;
  // quieter recipients widen it to see more history. Allowed values are
  // 25 / 50 / 100 / 250; defaults to 100 to match the prior hard-coded cap.
  jobMetricAlertQuietHoursDigestMaxEvents: integer("job_metric_alert_quiet_hours_digest_max_events").notNull().default(100),
  // Task #797: per-recipient locale & format preferences for the
  // quiet-hours digest timestamps (window range + per-event rows). The
  // engine still localizes to `jobMetricAlertQuietHoursTimezone`, but
  // these fields control how the rendered date/time string looks.
  //   - `Locale`        : optional BCP-47 tag (e.g. "en-GB", "fr-FR").
  //                       Null falls back to "en-US" so existing
  //                       recipients see no behavior change.
  //   - `TimeFormat`    : "12h" → "6:00 PM" (legacy), "24h" → "18:00".
  //   - `ShowWeekday`   : when true, a short weekday is prepended
  //                       (e.g. "Wed Jan 14, 18:00 PST").
  jobMetricAlertQuietHoursDigestLocale: text("job_metric_alert_quiet_hours_digest_locale"),
  jobMetricAlertQuietHoursDigestTimeFormat: jobMetricAlertQuietHoursDigestTimeFormatEnum(
    "job_metric_alert_quiet_hours_digest_time_format",
  ).notNull().default("12h"),
  jobMetricAlertQuietHoursDigestShowWeekday: boolean(
    "job_metric_alert_quiet_hours_digest_show_weekday",
  ).notNull().default(false),
  // Task #1021 — Per-admin delivery preferences for the CRM transcript
  // backfill completion summary added in Task #1006. The default keeps the
  // legacy behavior (email summary on every run) so existing admins see no
  // change until they pick a different channel or the failure-only filter.
  //   - `Channel`           : "email" | "slack" | "teams" | "none". When
  //                           "slack"/"teams" the user's webhook from
  //                           notification_channel_prefs is used; "none"
  //                           silences the summary entirely.
  //   - `OnFailureOnly`     : when true, only failed runs trigger a summary
  //                           — successful runs are silent.
  crmBackfillSummaryChannel: backfillSummaryChannelEnum(
    "crm_backfill_summary_channel",
  ).notNull().default("email"),
  crmBackfillSummaryOnFailureOnly: boolean(
    "crm_backfill_summary_on_failure_only",
  ).notNull().default(false),
  // Task #1066 — per-admin opt-out for the Task #1051 fallback emails sent
  // when an alert delivery (Slack/email) fails. The global
  // `crmBackfillSummaryChannel = "none"` already silences both the run
  // summary AND these fallbacks, but admins who want completion summaries
  // and only want to mute the failure fan-out (or mute it for a single
  // failing channel — e.g. ignore Slack failures while still being told
  // about email failures) need finer control.
  //   - `Enabled`         : when false, this admin never receives the
  //                         fallback email regardless of which channel
  //                         failed. Defaults to true so existing admins
  //                         keep getting alerted.
  //   - `MutedChannels`   : list of failing-delivery channels to mute
  //                         (allowed values: "slack", "email"). When the
  //                         failed channel is in this list the admin is
  //                         skipped, but other channels still alert.
  crmAlertFailureFallbackEnabled: boolean(
    "crm_alert_failure_fallback_enabled",
  ).notNull().default(true),
  crmAlertFailureFallbackMutedChannels: text(
    "crm_alert_failure_fallback_muted_channels",
  ).array().notNull().default(sql`'{}'::text[]`),
  // Task #1076 — Per-admin opt-in for the two streams of CRM transcript-backfill
  // alert delivery failure emails. The default ("both") preserves the legacy
  // Task #1051 + Task #1065 behavior so existing admins see no change until
  // they pick a different mode. See `alertFailureEmailModeEnum` for the full
  // value docs. This is orthogonal to the Task #1066 mute knobs above:
  // both filters are applied (mode picks the stream, mutes pick the failing
  // channel for the realtime stream).
  alertFailureEmailMode: alertFailureEmailModeEnum(
    "alert_failure_email_mode",
  ).notNull().default("both"),
  // Task #1414 — Per-admin opt-out toggle for the
  // INTEGRATION_SYNC_RETRIES_EXHAUSTED transactional email. The fan-out
  // ships this email by default (regardless of `notificationDelivery`
  // channel preferences) because admins might miss the in-app bell for
  // days; flipping this column to `true` silences the email for that
  // admin while leaving the in-app notification intact. Mirrors the
  // CRM `alert_failure_email_mode` opt-out pattern.
  integrationSyncExhaustedEmailOptOut: boolean(
    "integration_sync_exhausted_email_opt_out",
  ).notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  orgIdx: index("users_organization_id_idx").on(table.organizationId),
  activeRoleIdx: index("users_active_role_idx").on(table.isActive, table.role),
}));

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
  budgetAmount: decimal("budget_amount", { precision: 12, scale: 2 }),
  texturaDrawDate: date("textura_draw_date"),
  drawDayOfMonth: integer("draw_day_of_month"),
  estimatorId: varchar("estimator_id").references(() => users.id),
  superintendentId: varchar("superintendent_id").references(() => users.id),
  projectManagerId: varchar("project_manager_id").references(() => users.id),
  gcOrganizationId: varchar("gc_organization_id"),
  ownerRepOrganizationId: varchar("owner_rep_organization_id"),
  siteLatitude: doublePrecision("site_latitude"),
  siteLongitude: doublePrecision("site_longitude"),
  lastGeocodeAttemptAt: timestamp("last_geocode_attempt_at"),
  lastGeocodeStatus: text("last_geocode_status"),
  geocodeAttemptCount: integer("geocode_attempt_count").notNull().default(0),
  geofenceRadius: integer("geofence_radius"),
  geofenceEnforcement: geofenceEnforcementEnum("geofence_enforcement").notNull().default("OFF"),
  budgetAlertThreshold: decimal("budget_alert_threshold", { precision: 5, scale: 2 }).default("80"),
  budgetCriticalThreshold: decimal("budget_critical_threshold", { precision: 5, scale: 2 }).default("95"),
  autoInvoice: boolean("auto_invoice").default(false),
  autoChangeOrderEnabled: boolean("auto_change_order_enabled").notNull().default(true),
  autoChangeOrderThreshold: decimal("auto_change_order_threshold", { precision: 12, scale: 2 }).default("0"),
  safetyOfficerId: varchar("safety_officer_id").references(() => users.id, { onDelete: "set null" }),
  payrollFormVariant: payrollFormVariantEnum("payroll_form_variant").notNull().default("WH_347"),
  // Task #494: project-level Davis-Bacon wage decision number (e.g. "CA20240001").
  // When set, the WH-347 generator looks up cached DOL rates for any
  // classification missing an explicit per-project `prevailingWageRates` entry,
  // and the UI surfaces a warning if the referenced determination has not yet
  // been imported via the DOL/SAM.gov Davis-Bacon sync.
  wageDecision: text("wage_decision"),
  // Task #900: first-class portfolio rollup dimensions. Optional free-form
  // labels for Program (e.g. "Highway 87 Corridor") and Division (e.g.
  // "Northern Region") plus an explicit trade type. When null,
  // `server/portfolioRoutes.ts` falls back to the legacy proxies
  // (clientName for program, state for division, single bucket for trade).
  programId: text("program_id"),
  divisionId: text("division_id"),
  primaryTradeType: tradeTypeEnum("primary_trade_type"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  statusIdx: index("projects_status_idx").on(table.status),
  gcOrgIdx: index("projects_gc_org_id_idx").on(table.gcOrganizationId),
  programIdx: index("projects_program_id_idx").on(table.programId),
  divisionIdx: index("projects_division_id_idx").on(table.divisionId),
  primaryTradeIdx: index("projects_primary_trade_type_idx").on(table.primaryTradeType),
}));

export const projectGeofenceZones = pgTable("project_geofence_zones", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  type: varchar("type", { length: 10 }).notNull().default("circle"),
  latitude: doublePrecision("latitude"),
  longitude: doublePrecision("longitude"),
  radius: integer("radius"),
  polygon: text("polygon"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  projectIdIdx: index("geofence_zones_project_id_idx").on(table.projectId),
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
  crmOpportunityId: varchar("crm_opportunity_id"),
  aiWinProbability: integer("ai_win_probability"),
  awardedAt: timestamp("awarded_at"),
  submittedAt: timestamp("submitted_at"),
  // Davis-Bacon / prevailing-wage decision number (e.g. "CA20260010").
  // When set on a bid, it is propagated to projects.wageDecision during
  // bid → project conversion (see server/bidRoutes2.ts) and triggers
  // queueWageDecisionSync so the rates auto-import (Task #1386).
  wageDecision: text("wage_decision"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  statusIdx: index("bids_status_idx").on(table.status),
  gcOrgIdx: index("bids_gc_org_id_idx").on(table.gcOrganizationId),
}));

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

