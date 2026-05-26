// AUTO-GENERATED SPLIT FROM shared/schema/features.ts (Task #2426).
// Domain bucketing rule lives in shared/schema/features/index.ts.
import { sql } from "drizzle-orm";
import { pgTable, text, varchar, boolean, timestamp, date, decimal, integer, pgEnum, doublePrecision, index, unique, uniqueIndex, json, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod";
import { addendumRecipientTypeEnum, addendumStatusEnum, aiBidDocumentAnalysisStatusEnum, aiCoDraftStatusEnum, aiContractDocumentAnalysisStatusEnum, contractStatusEnum, contractTypeEnum, contractRedlineStatusEnum, contractApprovalDecisionEnum, clauseCategoryEnum, signatureRequestStatusEnum, signerStatusEnum, aiInsightModuleEnum, aiInsightSeverityEnum, aiTakeoffModeEnum, aiTakeoffStatusEnum, aiTakeoffSuggestionStatusEnum, aiTakeoffRejectReasonEnum, aiTaskPriorityEnum, aiTaskStatusEnum, approvalEntityTypeEnum, approvalStatusEnum, atsProviderEnum, bidEquipmentSourceEnum, bidInvitationStatusEnum, bidRequestStatusEnum, bidResponseStatusEnum, blogCommentStatusEnum, blogPostStatusEnum, conversationTypeEnum, crewAvailabilityStatusEnum, crmActivityTypeEnum, crmCallDirectionEnum, crmCallOutcomeEnum, crmCallStatusEnum, crmCustomFieldEntityEnum, crmCustomFieldTypeEnum, crmContactRoleEnum, crmNoteTypeEnum, crmOrgStatusEnum, crmOrganisationTypeEnum, crmPipelineStageEnum, crmPreferredContactEnum, crmLostCategoryEnum, crmQuoteAcceptanceStatusEnum, crmLeadScoringOperatorEnum, crmSequenceStatusEnum, crmSequenceStepTypeEnum, crmSequenceEnrollmentStatusEnum, crmSequenceExecutionStatusEnum, crmSequenceEmailEventTypeEnum, crmSequenceExitReasonEnum, crmQuoteApprovalStatusEnum, dataSubjectRequestStatusEnum, dataSubjectRequestTypeEnum, documentRevisionSourceEnum, documentRevisionStatusEnum, emailClassificationEnum, emailProviderEnum, emailTaskSourceEnum, emailThreadStatusEnum, hiringActivityTypeEnum, hiringCandidateStageEnum, hiringCompensationTypeEnum, hiringEmploymentTypeEnum, hiringInterviewStatusEnum, hiringJobStatusEnum, hiringSyncStatusEnum, hustlerDelegateRoleEnum, hustlerLinkRequestStatusEnum, installationStatusEnum, lidarScanStatusEnum, lidarAnnotationTypeEnum, lidarComparisonTypeEnum, unifiedPaymentMethodEnum, unifiedPaymentStatusEnum, invoiceTypeEnum, integrationConnectionStatusEnum, integrationEventStatusEnum, integrationProviderEnum, issueSeverityEnum, issueStatusEnum, jobsiteAnalysisStatusEnum, lienWaiverStatusEnum, lienWaiverTypeEnum, locationLevelEnum, maintenanceTypeEnum, measurementReviewStatusEnum, measurementSourceEnum, measurementStatusEnum, measurementTypeEnum, takeoffVersionStatusEnum, messageEntityTypeEnum, mobilePlatformEnum, offlineEntityTypeEnum, offlineOperationTypeEnum, offlineSyncStatusEnum, organizationDocumentTypeEnum, organizationDocumentVisibilityEnum, overheadCostActionEnum, overheadCostCategoryEnum, overheadCostFrequencyEnum, portalChatPriorityEnum, portalChatThreadCategoryEnum, portalChatThreadStatusEnum, pricebookImportJobStatusEnum, pricebookStatusEnum, pricingApprovalStatusEnum, pricingSourceTypeEnum, projectEquipmentPlanStatusEnum, repairStatusEnum, retentionActionEnum, retentionEntityTypeEnum, rewardTypeEnum, rfiCategoryEnum, rfiPriorityEnum, rfiStatusEnum, scheduleDependencyTypeEnum, scheduleGeneratedByEnum, scheduleTaskStatusEnum, socialAccountStatusEnum, socialPlatformEnum, socialPostStatusEnum, sovPaymentMethodEnum, sovStatusEnum, storedMaterialStatusEnum, retentionReleaseTypeEnum, retentionReleaseStatusEnum, sowAuditActionEnum, ssoProviderEnum, submittalCategoryEnum, submittalItemStatusEnum, submittalPhaseEnum, submittalReviewRoleEnum, submittalReviewStatusEnum, submittalStatusEnum, submittalTypeEnum, syncStatusEnum, tradeTypeEnum, transmittalStatusEnum, userRoleEnum, vendorEnrollmentStatusEnum, voiceLogStatusEnum, websiteDeploymentActionEnum, websitePageTypeEnum, websiteProjectStatusEnum, websiteStatusEnum, takeoffIssueCategoryEnum, takeoffIssueStatusEnum, talentAvailabilityEnum, talentProfileVisibilityEnum, workflowEntityTypeEnum, riskCategoryEnum, riskStatusEnum, workflowTemplateStatusEnum, workflowInstanceStatusEnum, videoCallStatusEnum, workflowNotificationChannelEnum, dotAgencyKindEnum, dotPayItemTypeEnum, dbeCertificationTypeEnum, suretyBondTypeEnum, suretyBondStatusEnum, haulTicketStatusEnum, swpppInspectionTypeEnum, idrStatusEnum, buyAmericaStatusEnum } from "../enums";
import { bids, organizations, projects, users } from "../core";
import { changeOrders, estimateLineItems, estimates, planDocuments, projectInspections, tasks, tmTickets } from "../operations";



export const safetyIncidents = pgTable("safety_incidents", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  date: text("date").notNull(),
  severity: text("severity").notNull(),
  description: text("description").notNull(),
  actionTaken: text("action_taken"),
  recordedBy: varchar("recorded_by").references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertSafetyIncidentSchema = createInsertSchema(safetyIncidents).omit({ id: true, createdAt: true });
export type InsertSafetyIncident = z.infer<typeof insertSafetyIncidentSchema>;
export type SafetyIncident = typeof safetyIncidents.$inferSelect;

export const qualityIssues = pgTable("quality_issues", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  date: text("date").notNull(),
  category: text("category").notNull(),
  description: text("description").notNull(),
  resolution: text("resolution"),
  recordedBy: varchar("recorded_by").references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertQualityIssueSchema = createInsertSchema(qualityIssues).omit({ id: true, createdAt: true });
export type InsertQualityIssue = z.infer<typeof insertQualityIssueSchema>;
export type QualityIssue = typeof qualityIssues.$inferSelect;

// ─── Safety Training Programs ───────────────────────────────────────────────
export const safetyTrainings = pgTable("safety_trainings", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  description: text("description"),
  category: text("category").notNull(),
  frequency: text("frequency").notNull().default("ONCE"),
  durationMinutes: integer("duration_minutes"),
  materials: text("materials"),
  isActive: boolean("is_active").notNull().default(true),
  createdBy: varchar("created_by").references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertSafetyTrainingSchema = createInsertSchema(safetyTrainings).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertSafetyTraining = z.infer<typeof insertSafetyTrainingSchema>;
export type SafetyTraining = typeof safetyTrainings.$inferSelect;

// ─── Safety Training Assignments ─────────────────────────────────────────────
export const safetyTrainingAssignments = pgTable("safety_training_assignments", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  trainingId: varchar("training_id").notNull().references(() => safetyTrainings.id, { onDelete: "cascade" }),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  employeeId: varchar("employee_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  assignedBy: varchar("assigned_by").references(() => users.id),
  assignedAt: timestamp("assigned_at").notNull().defaultNow(),
  dueDate: text("due_date"),
  status: text("status").notNull().default("PENDING"),
  completedAt: timestamp("completed_at"),
  completedByName: text("completed_by_name"),
  notes: text("notes"),
  acknowledgmentSignature: text("acknowledgment_signature"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertSafetyTrainingAssignmentSchema = createInsertSchema(safetyTrainingAssignments).omit({ id: true, createdAt: true, assignedAt: true });
export type InsertSafetyTrainingAssignment = z.infer<typeof insertSafetyTrainingAssignmentSchema>;
export type SafetyTrainingAssignment = typeof safetyTrainingAssignments.$inferSelect;

// ==================== Toolbox Talks ====================

export const toolboxTalkTopics = pgTable("toolbox_talk_topics", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  content: text("content"),
  category: text("category").notNull(),
  attachments: text("attachments"),
  isActive: boolean("is_active").notNull().default(true),
  createdBy: varchar("created_by").references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertToolboxTalkTopicSchema = createInsertSchema(toolboxTalkTopics).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertToolboxTalkTopic = z.infer<typeof insertToolboxTalkTopicSchema>;
export type ToolboxTalkTopic = typeof toolboxTalkTopics.$inferSelect;

export const toolboxTalkScheduled = pgTable("toolbox_talk_scheduled", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  topicId: varchar("topic_id").notNull().references(() => toolboxTalkTopics.id, { onDelete: "cascade" }),
  projectId: varchar("project_id").references(() => projects.id, { onDelete: "set null" }),
  scheduledDate: text("scheduled_date").notNull(),
  presenter: text("presenter"),
  presenterId: varchar("presenter_id").references(() => users.id),
  status: text("status").notNull().default("SCHEDULED"),
  notes: text("notes"),
  completedAt: timestamp("completed_at"),
  createdBy: varchar("created_by").references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertToolboxTalkScheduledSchema = createInsertSchema(toolboxTalkScheduled).omit({ id: true, createdAt: true });
export type InsertToolboxTalkScheduled = z.infer<typeof insertToolboxTalkScheduledSchema>;
export type ToolboxTalkScheduled = typeof toolboxTalkScheduled.$inferSelect;

export const toolboxTalkAttendance = pgTable("toolbox_talk_attendance", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  scheduledTalkId: varchar("scheduled_talk_id").notNull().references(() => toolboxTalkScheduled.id, { onDelete: "cascade" }),
  employeeId: varchar("employee_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  signedAt: timestamp("signed_at").notNull().defaultNow(),
  signature: text("signature"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertToolboxTalkAttendanceSchema = createInsertSchema(toolboxTalkAttendance).omit({ id: true, createdAt: true, signedAt: true });
export type InsertToolboxTalkAttendance = z.infer<typeof insertToolboxTalkAttendanceSchema>;
export type ToolboxTalkAttendance = typeof toolboxTalkAttendance.$inferSelect;

// ==================== Safety Checklists ====================

export const safetyChecklistTemplates = pgTable("safety_checklist_templates", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  category: text("category").notNull(),
  itemsJson: text("items_json").notNull().default("[]"),
  isActive: boolean("is_active").notNull().default(true),
  createdBy: varchar("created_by").references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertSafetyChecklistTemplateSchema = createInsertSchema(safetyChecklistTemplates).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertSafetyChecklistTemplate = z.infer<typeof insertSafetyChecklistTemplateSchema>;
export type SafetyChecklistTemplate = typeof safetyChecklistTemplates.$inferSelect;

export const safetyChecklistInstances = pgTable("safety_checklist_instances", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  templateId: varchar("template_id").notNull().references(() => safetyChecklistTemplates.id, { onDelete: "cascade" }),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  projectId: varchar("project_id").references(() => projects.id, { onDelete: "set null" }),
  completedBy: varchar("completed_by").notNull().references(() => users.id),
  completedByName: text("completed_by_name"),
  status: text("status").notNull().default("IN_PROGRESS"),
  responsesJson: text("responses_json").notNull().default("[]"),
  notes: text("notes"),
  photoUrls: text("photo_urls"),
  completedAt: timestamp("completed_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertSafetyChecklistInstanceSchema = createInsertSchema(safetyChecklistInstances).omit({ id: true, createdAt: true });

// ─── Safety Observations (positive & at-risk) ───────────────────────────────
export const safetyObservations = pgTable("safety_observations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  projectId: varchar("project_id").references(() => projects.id, { onDelete: "set null" }),
  observationType: text("observation_type").notNull(), // POSITIVE | AT_RISK
  category: text("category").notNull(), // PPE, FALL_PROTECTION, HOUSEKEEPING, ELECTRICAL, EXCAVATION, ERGONOMICS, ENVIRONMENTAL, BEHAVIOR, EQUIPMENT, OTHER
  severity: text("severity").notNull().default("LOW"), // LOW | MEDIUM | HIGH | CRITICAL
  location: text("location"),
  description: text("description").notNull(),
  immediateAction: text("immediate_action"),
  photos: text("photos").array().default(sql`ARRAY[]::text[]`),
  observedAt: timestamp("observed_at").notNull().defaultNow(),
  observedBy: varchar("observed_by").references(() => users.id, { onDelete: "set null" }),
  observedByName: text("observed_by_name"),
  involvedPartyName: text("involved_party_name"),
  involvedTrade: text("involved_trade"),
  status: text("status").notNull().default("OPEN"), // OPEN | IN_REVIEW | CLOSED
  correctiveActionId: varchar("corrective_action_id"),
  closedAt: timestamp("closed_at"),
  closedBy: varchar("closed_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  orgIdx: index("safety_observations_org_idx").on(table.organizationId),
  projectIdx: index("safety_observations_project_idx").on(table.projectId),
  observedAtIdx: index("safety_observations_observed_at_idx").on(table.observedAt),
  typeIdx: index("safety_observations_type_idx").on(table.observationType),
}));

export const insertSafetyObservationSchema = createInsertSchema(safetyObservations).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertSafetyObservation = z.infer<typeof insertSafetyObservationSchema>;
export type SafetyObservation = typeof safetyObservations.$inferSelect;
export type InsertSafetyChecklistInstance = z.infer<typeof insertSafetyChecklistInstanceSchema>;
export type SafetyChecklistInstance = typeof safetyChecklistInstances.$inferSelect;

// ==================== OSHA Incident Reporting ====================

export const oshaIncidents = pgTable("osha_incidents", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  caseNumber: text("case_number").notNull(),
  projectId: varchar("project_id").references(() => projects.id, { onDelete: "set null" }),
  employeeName: text("employee_name").notNull(),
  employeeJobTitle: text("employee_job_title"),
  dateOfInjury: text("date_of_injury").notNull(),
  timeOfEvent: text("time_of_event"),
  locationOfIncident: text("location_of_incident"),
  eventDescription: text("event_description").notNull(),
  injuryIllnessType: text("injury_illness_type").notNull(),
  bodyPartAffected: text("body_part_affected").notNull(),
  objectOrSubstance: text("object_or_substance"),
  treatmentType: text("treatment_type").notNull(),
  hospitalName: text("hospital_name"),
  wasHospitalized: boolean("was_hospitalized").notNull().default(false),
  daysAwayFromWork: integer("days_away_from_work").default(0),
  daysOfRestrictedDuty: integer("days_of_restricted_duty").default(0),
  classification: text("classification").notNull(),
  isRecordable: boolean("is_recordable").notNull().default(true),
  resultedInDeath: boolean("resulted_in_death").notNull().default(false),
  reportedBy: varchar("reported_by").references(() => users.id),
  reportedByName: text("reported_by_name"),
  // Photo / file attachments captured at incident time. JSONB array of
  // `{ objectKey, mime?, name? }`. Populated by the mobile sync handler so
  // office staff can view field-uploaded photos from the incident detail
  // page; web `POST /api/osha-incidents` may also write this.
  attachmentsJson: jsonb("attachments_json").$type<Array<{ objectKey: string; mime?: string; name?: string }>>(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertOshaIncidentSchema = createInsertSchema(oshaIncidents).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertOshaIncident = z.infer<typeof insertOshaIncidentSchema>;
export type OshaIncident = typeof oshaIncidents.$inferSelect;