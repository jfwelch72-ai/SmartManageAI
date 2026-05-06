// AUTO-GENERATED SPLIT FROM shared/schema/features.ts (Task #2426).
// Domain bucketing rule lives in shared/schema/features/index.ts.
import { sql } from "drizzle-orm";
import { pgTable, text, varchar, boolean, timestamp, date, decimal, integer, pgEnum, doublePrecision, index, unique, uniqueIndex, json, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod";
import { addendumRecipientTypeEnum, addendumStatusEnum, aiBidDocumentAnalysisStatusEnum, aiCoDraftStatusEnum, aiContractDocumentAnalysisStatusEnum, contractStatusEnum, contractTypeEnum, contractRedlineStatusEnum, contractApprovalDecisionEnum, clauseCategoryEnum, signatureRequestStatusEnum, signerStatusEnum, aiInsightModuleEnum, aiInsightSeverityEnum, aiTakeoffModeEnum, aiTakeoffStatusEnum, aiTakeoffSuggestionStatusEnum, aiTakeoffRejectReasonEnum, aiTaskPriorityEnum, aiTaskStatusEnum, approvalEntityTypeEnum, approvalStatusEnum, atsProviderEnum, bidEquipmentSourceEnum, bidInvitationStatusEnum, bidRequestStatusEnum, bidResponseStatusEnum, blogCommentStatusEnum, blogPostStatusEnum, conversationTypeEnum, crewAvailabilityStatusEnum, crmActivityTypeEnum, crmCallDirectionEnum, crmCallOutcomeEnum, crmCallStatusEnum, crmCustomFieldEntityEnum, crmCustomFieldTypeEnum, crmContactRoleEnum, crmNoteTypeEnum, crmOrgStatusEnum, crmOrganisationTypeEnum, crmPipelineStageEnum, crmPreferredContactEnum, crmLostCategoryEnum, crmQuoteAcceptanceStatusEnum, crmLeadScoringOperatorEnum, crmSequenceStatusEnum, crmSequenceStepTypeEnum, crmSequenceEnrollmentStatusEnum, crmSequenceExecutionStatusEnum, crmSequenceEmailEventTypeEnum, crmSequenceExitReasonEnum, crmQuoteApprovalStatusEnum, dataSubjectRequestStatusEnum, dataSubjectRequestTypeEnum, documentRevisionSourceEnum, documentRevisionStatusEnum, emailClassificationEnum, emailProviderEnum, emailTaskSourceEnum, emailThreadStatusEnum, hiringActivityTypeEnum, hiringCandidateStageEnum, hiringCompensationTypeEnum, hiringEmploymentTypeEnum, hiringInterviewStatusEnum, hiringJobStatusEnum, hiringSyncStatusEnum, hustlerDelegateRoleEnum, hustlerLinkRequestStatusEnum, installationStatusEnum, lidarScanStatusEnum, lidarAnnotationTypeEnum, lidarComparisonTypeEnum, unifiedPaymentMethodEnum, unifiedPaymentStatusEnum, invoiceTypeEnum, integrationConnectionStatusEnum, integrationEventStatusEnum, integrationProviderEnum, issueSeverityEnum, issueStatusEnum, jobsiteAnalysisStatusEnum, lienWaiverStatusEnum, lienWaiverTypeEnum, locationLevelEnum, maintenanceTypeEnum, measurementReviewStatusEnum, measurementSourceEnum, measurementStatusEnum, measurementTypeEnum, takeoffVersionStatusEnum, messageEntityTypeEnum, mobilePlatformEnum, offlineEntityTypeEnum, offlineOperationTypeEnum, offlineSyncStatusEnum, organizationDocumentTypeEnum, organizationDocumentVisibilityEnum, overheadCostActionEnum, overheadCostCategoryEnum, overheadCostFrequencyEnum, portalChatPriorityEnum, portalChatThreadCategoryEnum, portalChatThreadStatusEnum, pricebookImportJobStatusEnum, pricebookStatusEnum, pricingApprovalStatusEnum, pricingSourceTypeEnum, projectEquipmentPlanStatusEnum, repairStatusEnum, retentionActionEnum, retentionEntityTypeEnum, rewardTypeEnum, rfiCategoryEnum, rfiPriorityEnum, rfiStatusEnum, scheduleDependencyTypeEnum, scheduleGeneratedByEnum, scheduleTaskStatusEnum, socialAccountStatusEnum, socialPlatformEnum, socialPostStatusEnum, sovPaymentMethodEnum, sovStatusEnum, storedMaterialStatusEnum, retentionReleaseTypeEnum, retentionReleaseStatusEnum, sowAuditActionEnum, ssoProviderEnum, submittalCategoryEnum, submittalItemStatusEnum, submittalPhaseEnum, submittalReviewRoleEnum, submittalReviewStatusEnum, submittalStatusEnum, submittalTypeEnum, syncStatusEnum, tradeTypeEnum, transmittalStatusEnum, userRoleEnum, vendorEnrollmentStatusEnum, voiceLogStatusEnum, websiteDeploymentActionEnum, websitePageTypeEnum, websiteProjectStatusEnum, websiteStatusEnum, takeoffIssueCategoryEnum, takeoffIssueStatusEnum, talentAvailabilityEnum, talentProfileVisibilityEnum, workflowEntityTypeEnum, riskCategoryEnum, riskStatusEnum, workflowTemplateStatusEnum, workflowInstanceStatusEnum, videoCallStatusEnum, workflowNotificationChannelEnum, dotAgencyKindEnum, dotPayItemTypeEnum, dbeCertificationTypeEnum, suretyBondTypeEnum, suretyBondStatusEnum, haulTicketStatusEnum, swpppInspectionTypeEnum, idrStatusEnum, buyAmericaStatusEnum } from "../enums";
import { bids, organizations, projects, users } from "../core";
import { changeOrders, estimateLineItems, estimates, planDocuments, projectInspections, tasks, tmTickets } from "../operations";
import { crews } from "./crew";
import { crmOrganisations } from "./crm";



// Equipment table - comprehensive equipment and tool management
export const equipment = pgTable("equipment", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  
  // Multi-tenant isolation
  organizationId: varchar("organization_id").notNull().references(() => organizations.id),
  
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
  
  // Depreciation Tracking
  depreciationMethod: text("depreciation_method"), // STRAIGHT_LINE or DECLINING_BALANCE
  usefulLifeYears: integer("useful_life_years"),
  salvageValue: decimal("salvage_value", { precision: 12, scale: 2 }),
  inServiceDate: date("in_service_date"),
  
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
  usefulLifeYears: z.preprocess(
    (val) => {
      if (val === '' || val === null || val === undefined) return null;
      const parsed = typeof val === 'string' ? parseInt(val, 10) : val;
      return isNaN(parsed as number) ? null : parsed;
    },
    z.number().int().min(1).max(100).nullable().optional()
  ),
  salvageValue: z.preprocess(
    (val) => {
      if (val === '' || val === null || val === undefined) return null;
      const parsed = typeof val === 'string' ? parseFloat(val) : val;
      return isNaN(parsed as number) ? null : String(parsed);
    },
    z.string().nullable().optional()
  ),
  depreciationMethod: z.preprocess(
    (val) => (val === '' || val === null || val === undefined) ? null : val,
    z.string().nullable().optional()
  ),
  inServiceDate: z.preprocess(
    (val) => (val === '' || val === null || val === undefined) ? null : val,
    z.string().nullable().optional()
  ),
});
export type ValidatedInsertEquipment = z.infer<typeof validatedEquipmentSchema>;

// ============================================================
// EQUIPMENT & TOOL MANAGEMENT SYSTEM
// Comprehensive tracking for construction equipment and tools
// ============================================================

// Equipment Status Enum
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

// Equipment Fuel Logs - Dedicated fuel tracking per fill-up
export const equipmentFuelLogs = pgTable("equipment_fuel_logs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  equipmentId: varchar("equipment_id").notNull().references(() => equipment.id, { onDelete: "cascade" }),
  projectId: varchar("project_id").references(() => projects.id, { onDelete: "set null" }),
  
  date: date("date").notNull(),
  gallons: decimal("gallons", { precision: 10, scale: 2 }).notNull(),
  pricePerGallon: decimal("price_per_gallon", { precision: 10, scale: 4 }).notNull(),
  totalCost: decimal("total_cost", { precision: 12, scale: 2 }).notNull(),
  fuelType: text("fuel_type").notNull().default("DIESEL"), // DIESEL, GASOLINE, PROPANE, ELECTRIC
  meterReading: decimal("meter_reading", { precision: 10, scale: 1 }),
  
  submittedById: varchar("submitted_by_id").notNull().references(() => users.id),
  notes: text("notes"),
  
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  equipmentIdx: index("equipment_fuel_logs_equipment_idx").on(table.equipmentId),
  projectIdx: index("equipment_fuel_logs_project_idx").on(table.projectId),
  dateIdx: index("equipment_fuel_logs_date_idx").on(table.date),
}));

export const insertEquipmentFuelLogSchema = createInsertSchema(equipmentFuelLogs).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertEquipmentFuelLog = z.infer<typeof insertEquipmentFuelLogSchema>;
export type EquipmentFuelLog = typeof equipmentFuelLogs.$inferSelect;

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

  organizationId: varchar("organization_id").references(() => organizations.id, { onDelete: "cascade" }),
  approvalStatus: pricingApprovalStatusEnum("rental_approval_status").default("AUTO_APPROVED"),
  sourceType: pricingSourceTypeEnum("rental_source_type").notNull().default("MANUAL"),
  effectiveQuarter: text("effective_quarter"),
  effectiveDate: timestamp("effective_date"),
  expirationDate: timestamp("expiration_date"),
  submittedByVendorUserId: varchar("submitted_by_vendor_user_id").references(() => users.id),
  
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  vendorIdx: index("rental_equipment_catalog_vendor_idx").on(table.vendorId),
  crmOrgIdx: index("rental_equipment_catalog_crm_org_idx").on(table.crmOrganisationId),
  typeIdx: index("rental_equipment_catalog_type_idx").on(table.equipmentType),
  orgIdx: index("rental_equipment_catalog_org_idx").on(table.organizationId),
}));

export const insertRentalEquipmentCatalogSchema = createInsertSchema(rentalEquipmentCatalog).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertRentalEquipmentCatalog = z.infer<typeof insertRentalEquipmentCatalogSchema>;
export type RentalEquipmentCatalog = typeof rentalEquipmentCatalog.$inferSelect;

export const vendorServiceCatalog = pgTable("vendor_service_catalog", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  crmOrganisationId: varchar("crm_organisation_id").notNull().references(() => crmOrganisations.id, { onDelete: "cascade" }),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),

  serviceName: text("service_name").notNull(),
  serviceCode: text("service_code"),
  category: text("category").notNull(),
  description: text("description"),
  unit: text("unit").notNull(),
  rate: decimal("rate", { precision: 12, scale: 4 }).notNull(),
  minimumHours: decimal("minimum_hours", { precision: 10, scale: 2 }),
  travelFee: decimal("travel_fee", { precision: 10, scale: 2 }),
  leadTimeDays: integer("lead_time_days"),

  approvalStatus: pricingApprovalStatusEnum("approval_status").default("AUTO_APPROVED"),
  effectiveQuarter: text("effective_quarter").notNull(),
  effectiveDate: timestamp("effective_date").notNull(),
  expirationDate: timestamp("expiration_date"),
  sourceType: pricingSourceTypeEnum("source_type").notNull().default("MANUAL"),
  submittedByVendorUserId: varchar("submitted_by_vendor_user_id").references(() => users.id),

  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  crmOrgIdx: index("vendor_service_catalog_crm_org_idx").on(table.crmOrganisationId),
  orgIdx: index("vendor_service_catalog_org_idx").on(table.organizationId),
  categoryIdx: index("vendor_service_catalog_category_idx").on(table.category),
  activeIdx: index("vendor_service_catalog_active_idx").on(table.isActive),
}));

export const insertVendorServiceCatalogSchema = createInsertSchema(vendorServiceCatalog).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertVendorServiceCatalog = z.infer<typeof insertVendorServiceCatalogSchema>;
export type VendorServiceCatalog = typeof vendorServiceCatalog.$inferSelect;

// Bid Equipment Selection Source Enum
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
  costCode: text("cost_code"),
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

// ==================================================
// EQUIPMENT RENTAL MARKETPLACE TABLES
// ==================================================

export const equipmentCategoryEnum = pgEnum("equipment_category", [
  "Excavation", "Lifting", "Concrete", "Compaction", "Aerial", "Power", "Scaffolding", "Other"
]);

export const equipmentConditionEnum = pgEnum("equipment_condition", ["Excellent", "Good", "Fair"]);

export const rentalRequestStatusEnum = pgEnum("rental_request_status", ["PENDING", "ACCEPTED", "DECLINED"]);

export const equipmentListings = pgTable("equipment_listings", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  category: equipmentCategoryEnum("category").notNull(),
  makeModel: text("make_model"),
  year: integer("year"),
  dailyRate: decimal("daily_rate", { precision: 10, scale: 2 }),
  weeklyRate: decimal("weekly_rate", { precision: 10, scale: 2 }),
  monthlyRate: decimal("monthly_rate", { precision: 10, scale: 2 }),
  depositAmount: decimal("deposit_amount", { precision: 10, scale: 2 }),
  location: text("location"),
  deliveryRadius: integer("delivery_radius"),
  photos: text("photos").array(),
  condition: equipmentConditionEnum("condition"),
  availableFrom: date("available_from"),
  availableTo: date("available_to"),
  isOngoing: boolean("is_ongoing").notNull().default(false),
  description: text("description"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  orgIdx: index("equipment_listings_org_idx").on(table.organizationId),
  categoryIdx: index("equipment_listings_category_idx").on(table.category),
  isActiveIdx: index("equipment_listings_is_active_idx").on(table.isActive),
}));

export const insertEquipmentListingSchema = createInsertSchema(equipmentListings).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertEquipmentListing = z.infer<typeof insertEquipmentListingSchema>;
export type EquipmentListing = typeof equipmentListings.$inferSelect;

export const equipmentRentalRequests = pgTable("equipment_rental_requests", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  listingId: varchar("listing_id").notNull().references(() => equipmentListings.id, { onDelete: "cascade" }),
  requesterOrgId: varchar("requester_org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  startDate: date("start_date").notNull(),
  endDate: date("end_date").notNull(),
  deliveryRequested: boolean("delivery_requested").notNull().default(false),
  message: text("message"),
  status: rentalRequestStatusEnum("status").notNull().default("PENDING"),
  ownerResponse: text("owner_response"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  listingIdx: index("equipment_rental_requests_listing_idx").on(table.listingId),
  requesterIdx: index("equipment_rental_requests_requester_idx").on(table.requesterOrgId),
  statusIdx: index("equipment_rental_requests_status_idx").on(table.status),
}));

export const insertEquipmentRentalRequestSchema = createInsertSchema(equipmentRentalRequests).omit({ id: true, createdAt: true, updatedAt: true, status: true, ownerResponse: true });
export type InsertEquipmentRentalRequest = z.infer<typeof insertEquipmentRentalRequestSchema>;
export type EquipmentRentalRequest = typeof equipmentRentalRequests.$inferSelect;