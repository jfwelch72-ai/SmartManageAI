// AUTO-GENERATED SPLIT FROM shared/schema/features.ts (Task #2426).
// Domain bucketing rule lives in shared/schema/features/index.ts.
import { sql } from "drizzle-orm";
import { pgTable, text, varchar, boolean, timestamp, date, decimal, integer, pgEnum, doublePrecision, index, unique, uniqueIndex, json, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod";
import { addendumRecipientTypeEnum, addendumStatusEnum, aiBidDocumentAnalysisStatusEnum, aiCoDraftStatusEnum, aiContractDocumentAnalysisStatusEnum, contractStatusEnum, contractTypeEnum, contractRedlineStatusEnum, contractApprovalDecisionEnum, clauseCategoryEnum, signatureRequestStatusEnum, signerStatusEnum, aiInsightModuleEnum, aiInsightSeverityEnum, aiTakeoffModeEnum, aiTakeoffStatusEnum, aiTakeoffSuggestionStatusEnum, aiTakeoffRejectReasonEnum, aiTaskPriorityEnum, aiTaskStatusEnum, approvalEntityTypeEnum, approvalStatusEnum, atsProviderEnum, bidEquipmentSourceEnum, bidInvitationStatusEnum, bidRequestStatusEnum, bidResponseStatusEnum, blogCommentStatusEnum, blogPostStatusEnum, conversationTypeEnum, crewAvailabilityStatusEnum, crmActivityTypeEnum, crmCallDirectionEnum, crmCallOutcomeEnum, crmCallStatusEnum, crmCustomFieldEntityEnum, crmCustomFieldTypeEnum, crmContactRoleEnum, crmNoteTypeEnum, crmOrgStatusEnum, crmOrganisationTypeEnum, crmPipelineStageEnum, crmPreferredContactEnum, crmLostCategoryEnum, crmQuoteAcceptanceStatusEnum, crmLeadScoringOperatorEnum, crmSequenceStatusEnum, crmSequenceStepTypeEnum, crmSequenceEnrollmentStatusEnum, crmSequenceExecutionStatusEnum, crmSequenceEmailEventTypeEnum, crmSequenceExitReasonEnum, crmQuoteApprovalStatusEnum, dataSubjectRequestStatusEnum, dataSubjectRequestTypeEnum, documentRevisionSourceEnum, documentRevisionStatusEnum, emailClassificationEnum, emailProviderEnum, emailTaskSourceEnum, emailThreadStatusEnum, hiringActivityTypeEnum, hiringCandidateStageEnum, hiringCompensationTypeEnum, hiringEmploymentTypeEnum, hiringInterviewStatusEnum, hiringJobStatusEnum, hiringSyncStatusEnum, hustlerDelegateRoleEnum, hustlerLinkRequestStatusEnum, installationStatusEnum, lidarScanStatusEnum, lidarAnnotationTypeEnum, lidarComparisonTypeEnum, unifiedPaymentMethodEnum, unifiedPaymentStatusEnum, invoiceTypeEnum, integrationConnectionStatusEnum, integrationEventStatusEnum, integrationProviderEnum, issueSeverityEnum, issueStatusEnum, jobsiteAnalysisStatusEnum, lienWaiverStatusEnum, lienWaiverTypeEnum, locationLevelEnum, maintenanceTypeEnum, measurementReviewStatusEnum, measurementSourceEnum, measurementStatusEnum, measurementTypeEnum, takeoffVersionStatusEnum, messageEntityTypeEnum, mobilePlatformEnum, offlineEntityTypeEnum, offlineOperationTypeEnum, offlineSyncStatusEnum, organizationDocumentTypeEnum, organizationDocumentVisibilityEnum, overheadCostActionEnum, overheadCostCategoryEnum, overheadCostFrequencyEnum, portalChatPriorityEnum, portalChatThreadCategoryEnum, portalChatThreadStatusEnum, pricebookImportJobStatusEnum, pricebookStatusEnum, pricingApprovalStatusEnum, pricingSourceTypeEnum, projectEquipmentPlanStatusEnum, repairStatusEnum, retentionActionEnum, retentionEntityTypeEnum, rewardTypeEnum, rfiCategoryEnum, rfiPriorityEnum, rfiStatusEnum, scheduleDependencyTypeEnum, scheduleGeneratedByEnum, scheduleTaskStatusEnum, socialAccountStatusEnum, socialPlatformEnum, socialPostStatusEnum, sovPaymentMethodEnum, sovStatusEnum, storedMaterialStatusEnum, retentionReleaseTypeEnum, retentionReleaseStatusEnum, sowAuditActionEnum, ssoProviderEnum, submittalCategoryEnum, submittalItemStatusEnum, submittalPhaseEnum, submittalReviewRoleEnum, submittalReviewStatusEnum, submittalStatusEnum, submittalTypeEnum, syncStatusEnum, tradeTypeEnum, transmittalStatusEnum, userRoleEnum, vendorEnrollmentStatusEnum, voiceLogStatusEnum, websiteDeploymentActionEnum, websitePageTypeEnum, websiteProjectStatusEnum, websiteStatusEnum, takeoffIssueCategoryEnum, takeoffIssueStatusEnum, talentAvailabilityEnum, talentProfileVisibilityEnum, workflowEntityTypeEnum, riskCategoryEnum, riskStatusEnum, workflowTemplateStatusEnum, workflowInstanceStatusEnum, videoCallStatusEnum, workflowNotificationChannelEnum, dotAgencyKindEnum, dotPayItemTypeEnum, dbeCertificationTypeEnum, suretyBondTypeEnum, suretyBondStatusEnum, haulTicketStatusEnum, swpppInspectionTypeEnum, idrStatusEnum, buyAmericaStatusEnum } from "../enums";
import { bids, organizations, projects, users } from "../core";
import { changeOrders, estimateLineItems, estimates, planDocuments, projectInspections, tasks, tmTickets } from "../operations";
import { emailMessages } from "./email";



// ===================
// CRM System Tables
// ===================

// CRM Organisations table - Companies (Contractors, Subcontractors, Suppliers, Vendors)
export const crmOrganisations = pgTable("crm_organisations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
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
  bondingCapacity: text("bonding_capacity"),
  tradeSpecialty: text("trade_specialty"),
  materialCategories: text("material_categories").array(),
  serviceCategory: text("service_category"),
  contractExpiration: timestamp("contract_expiration"),
  equipmentCategory: text("equipment_category"),
  rentalTerms: text("rental_terms"),
  companyRepresented: text("company_represented"),
  activeProjectIds: text("active_project_ids").array(),
  notes: text("notes"),
  crmStatus: crmOrgStatusEnum("crm_status").notNull().default("ACTIVE"),
  isActive: boolean("is_active").notNull().default(true),
  isDeleted: boolean("is_deleted").notNull().default(false),
  deletedAt: timestamp("deleted_at"),
  legacySubcontractorId: varchar("legacy_subcontractor_id"),
  // DBE / MBE / WBE quick-reference fields — detail records live in crm_organisation_certifications
  primaryCertificationType: text("primary_certification_type"),
  primaryCertificationExpiration: date("primary_certification_expiration"),
  certificationsSummary: text("certifications_summary"),
  // Task #731: explicit owner field on CRM organisations so reassignment events
  // can be detected and notified through the coalesced reassignment helper,
  // matching contacts/opportunities/projects.
  ownerId: varchar("owner_id").references(() => users.id, { onDelete: "set null" }),
  createdById: varchar("created_by_id").references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  organizationIdx: index("crm_organisations_org_idx").on(table.organizationId),
  typeIdx: index("crm_organisations_type_idx").on(table.type),
  nameIdx: index("crm_organisations_name_idx").on(table.name),
  isDeletedIdx: index("crm_organisations_is_deleted_idx").on(table.isDeleted),
  primaryCertIdx: index("crm_organisations_primary_cert_idx").on(table.primaryCertificationType),
  ownerIdx: index("crm_organisations_owner_idx").on(table.ownerId),
}));

export const insertCrmOrganisationSchema = createInsertSchema(crmOrganisations).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertCrmOrganisation = z.infer<typeof insertCrmOrganisationSchema>;
export type CrmOrganisation = typeof crmOrganisations.$inferSelect;

// CRM Contacts table - People associated with organisations
export const crmContacts = pgTable("crm_contacts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
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
  timezone: text("timezone"),
  birthday: date("birthday"),
  notes: text("notes"),
  isPrimary: boolean("is_primary").notNull().default(false),
  isActive: boolean("is_active").notNull().default(true),
  ownerId: varchar("owner_id").references(() => users.id, { onDelete: "set null" }),
  createdById: varchar("created_by_id").references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  organizationIdx: index("crm_contacts_org_idx").on(table.organizationId),
  organisationIdx: index("crm_contacts_organisation_idx").on(table.organisationId),
  ownerIdx: index("crm_contacts_owner_idx").on(table.ownerId),
}));

export const insertCrmContactSchema = createInsertSchema(crmContacts).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertCrmContact = z.infer<typeof insertCrmContactSchema>;
export type CrmContact = typeof crmContacts.$inferSelect;

// CRM Organisation Notes table - Activity log for tracking interactions
// Auto-timestamps to track when managers contact organizations/people
export const crmOrganisationNotes = pgTable("crm_organisation_notes", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
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

// CRM Custom Field Definitions - tenant-defined fields for contacts/orgs/opportunities
export const crmCustomFieldDefinitions = pgTable("crm_custom_field_definitions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  entityType: crmCustomFieldEntityEnum("entity_type").notNull(),
  key: text("key").notNull(),
  label: text("label").notNull(),
  fieldType: crmCustomFieldTypeEnum("field_type").notNull(),
  options: jsonb("options"),
  isRequired: boolean("is_required").notNull().default(false),
  defaultValue: jsonb("default_value"),
  helpText: text("help_text"),
  sortOrder: integer("sort_order").notNull().default(0),
  isActive: boolean("is_active").notNull().default(true),
  createdById: varchar("created_by_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  orgEntityIdx: index("crm_cfd_org_entity_idx").on(table.organizationId, table.entityType),
  uniqueKey: uniqueIndex("crm_cfd_org_entity_key_unique").on(table.organizationId, table.entityType, table.key),
}));

export const insertCrmCustomFieldDefinitionSchema = createInsertSchema(crmCustomFieldDefinitions).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertCrmCustomFieldDefinition = z.infer<typeof insertCrmCustomFieldDefinitionSchema>;
export type CrmCustomFieldDefinition = typeof crmCustomFieldDefinitions.$inferSelect;

// CRM Custom Field Values - per-entity value storage
export const crmCustomFieldValues = pgTable("crm_custom_field_values", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  definitionId: varchar("definition_id").notNull().references(() => crmCustomFieldDefinitions.id, { onDelete: "cascade" }),
  entityType: crmCustomFieldEntityEnum("entity_type").notNull(),
  entityId: varchar("entity_id").notNull(),
  value: jsonb("value"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  entityIdx: index("crm_cfv_entity_idx").on(table.entityType, table.entityId),
  defIdx: index("crm_cfv_def_idx").on(table.definitionId),
  uniqueDefEntity: uniqueIndex("crm_cfv_def_entity_unique").on(table.definitionId, table.entityId),
}));

export const insertCrmCustomFieldValueSchema = createInsertSchema(crmCustomFieldValues).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertCrmCustomFieldValue = z.infer<typeof insertCrmCustomFieldValueSchema>;
export type CrmCustomFieldValue = typeof crmCustomFieldValues.$inferSelect;

// CRM Opportunities (Sales Pipeline) - tracks deals from lead to won/lost
export const crmOpportunities = pgTable("crm_opportunities", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  stage: crmPipelineStageEnum("stage").notNull().default("LEAD"),
  dealValue: decimal("deal_value", { precision: 14, scale: 2 }),
  probability: integer("probability").default(10),
  crmOrganisationId: varchar("crm_organisation_id").references(() => crmOrganisations.id, { onDelete: "set null" }),
  contactId: varchar("contact_id").references(() => crmContacts.id, { onDelete: "set null" }),
  assignedToId: varchar("assigned_to_id").references(() => users.id, { onDelete: "set null" }),
  projectType: text("project_type"),
  projectLocation: text("project_location"),
  expectedCloseDate: date("expected_close_date"),
  source: text("source"),
  notes: text("notes"),
  lostReason: text("lost_reason"),
  lostCategory: crmLostCategoryEnum("lost_category"),
  leadScore: integer("lead_score").default(0),
  wonAt: timestamp("won_at"),
  lostAt: timestamp("lost_at"),
  aiWinProbability: integer("ai_win_probability"),
  aiWinProbabilityRationale: text("ai_win_probability_rationale"),
  stageEnteredAt: timestamp("stage_entered_at").defaultNow(),
  slaBreachedAt: timestamp("sla_breached_at"),
  needsAttentionReason: text("needs_attention_reason"),
  createdById: varchar("created_by_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  orgIdx: index("crm_opportunities_org_idx").on(table.organizationId),
  stageIdx: index("crm_opportunities_stage_idx").on(table.stage),
  assignedIdx: index("crm_opportunities_assigned_idx").on(table.assignedToId),
  slaIdx: index("crm_opportunities_sla_idx").on(table.slaBreachedAt),
}));

export const insertCrmOpportunitySchema = createInsertSchema(crmOpportunities).omit({ id: true, createdAt: true, updatedAt: true, aiWinProbability: true, aiWinProbabilityRationale: true });
export type InsertCrmOpportunity = z.infer<typeof insertCrmOpportunitySchema>;
export type CrmOpportunity = typeof crmOpportunities.$inferSelect;

// CRM Opportunity Activities - calls, emails, meetings logged against an opportunity
export const crmOpportunityActivities = pgTable("crm_opportunity_activities", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  opportunityId: varchar("opportunity_id").notNull().references(() => crmOpportunities.id, { onDelete: "cascade" }),
  activityType: crmActivityTypeEnum("activity_type").notNull().default("NOTE"),
  description: text("description").notNull(),
  scheduledAt: timestamp("scheduled_at"),
  completedAt: timestamp("completed_at"),
  createdById: varchar("created_by_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  opportunityIdx: index("crm_opp_activities_opp_idx").on(table.opportunityId),
  createdAtIdx: index("crm_opp_activities_created_at_idx").on(table.createdAt),
}));

export const insertCrmOpportunityActivitySchema = createInsertSchema(crmOpportunityActivities).omit({ id: true, createdAt: true });
export type InsertCrmOpportunityActivity = z.infer<typeof insertCrmOpportunityActivitySchema>;
export type CrmOpportunityActivity = typeof crmOpportunityActivities.$inferSelect;

// Task #890: CRM Call logs (manual + Twilio click-to-call). One row per call.
export const crmCalls = pgTable("crm_calls", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  opportunityId: varchar("opportunity_id").references(() => crmOpportunities.id, { onDelete: "set null" }),
  crmOrganisationId: varchar("crm_organisation_id").references(() => crmOrganisations.id, { onDelete: "set null" }),
  contactId: varchar("contact_id").references(() => crmContacts.id, { onDelete: "set null" }),
  direction: crmCallDirectionEnum("direction").notNull().default("OUTBOUND"),
  outcome: crmCallOutcomeEnum("outcome"),
  status: crmCallStatusEnum("status").notNull().default("LOGGED"),
  fromNumber: text("from_number"),
  toNumber: text("to_number"),
  durationSeconds: integer("duration_seconds").notNull().default(0),
  startedAt: timestamp("started_at").notNull().defaultNow(),
  endedAt: timestamp("ended_at"),
  notes: text("notes"),
  twilioCallSid: text("twilio_call_sid"),
  twilioRecordingSid: text("twilio_recording_sid"),
  source: text("source").notNull().default("MANUAL"),
  createdById: varchar("created_by_id").references(() => users.id, { onDelete: "set null" }),
  // Task #924: explicit owner so bulk reassignment doesn't lose the original
  // logger (createdById), and a follow-up timestamp so cleanup workflows can
  // stamp many calls at once.
  ownerId: varchar("owner_id").references(() => users.id, { onDelete: "set null" }),
  followUpAt: timestamp("follow_up_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  orgIdx: index("crm_calls_org_idx").on(table.organizationId),
  oppIdx: index("crm_calls_opp_idx").on(table.opportunityId),
  contactIdx: index("crm_calls_contact_idx").on(table.contactId),
  startedAtIdx: index("crm_calls_started_at_idx").on(table.startedAt),
  twilioSidIdx: uniqueIndex("crm_calls_twilio_sid_idx").on(table.twilioCallSid),
  ownerIdx: index("crm_calls_owner_idx").on(table.ownerId),
  followUpIdx: index("crm_calls_follow_up_at_idx").on(table.followUpAt),
}));
export const insertCrmCallSchema = createInsertSchema(crmCalls).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertCrmCall = z.infer<typeof insertCrmCallSchema>;
export type CrmCall = typeof crmCalls.$inferSelect;

export const crmCallRecordings = pgTable("crm_call_recordings", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  callId: varchar("call_id").notNull().references(() => crmCalls.id, { onDelete: "cascade" }),
  recordingUrl: text("recording_url").notNull(),
  durationSeconds: integer("duration_seconds").notNull().default(0),
  twilioRecordingSid: text("twilio_recording_sid"),
  transcript: text("transcript"),
  transcriptStatus: text("transcript_status").notNull().default("PENDING"),
  transcriptProvider: text("transcript_provider"),
  transcriptError: text("transcript_error"),
  transcribedAt: timestamp("transcribed_at"),
  summary: jsonb("summary"),
  summaryGeneratedAt: timestamp("summary_generated_at"),
  storageKey: text("storage_key"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  callIdx: index("crm_call_recordings_call_idx").on(table.callId),
}));
export const insertCrmCallRecordingSchema = createInsertSchema(crmCallRecordings).omit({ id: true, createdAt: true });
export type InsertCrmCallRecording = z.infer<typeof insertCrmCallRecordingSchema>;
export type CrmCallRecording = typeof crmCallRecordings.$inferSelect;

// Task #969 — persist transcript backfill job state so admins can still see
// progress (or the last-known status) after a server restart.
export const crmTranscriptBackfillJobs = pgTable("crm_transcript_backfill_jobs", {
  id: varchar("id").primaryKey(),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  status: text("status").notNull().default("RUNNING"),
  total: integer("total").notNull().default(0),
  processed: integer("processed").notNull().default(0),
  succeeded: integer("succeeded").notNull().default(0),
  failed: integer("failed").notNull().default(0),
  errors: jsonb("errors").$type<Array<{ recordingId: string; error: string }>>().notNull().default([]),
  // Task #1003 — `errors` is bounded to a sample so the row stays small, but
  // the targeted retry endpoint needs the *full* list of failed recordingIds
  // (potentially hundreds) so it can re-run every failure, not just the
  // sampled subset.
  failedRecordingIds: jsonb("failed_recording_ids").$type<string[]>().notNull().default([]),
  startedById: varchar("started_by_id").references(() => users.id, { onDelete: "set null" }),
  // Task #996 — when this job is a targeted retry of a previous run's failed
  // recordings, link back to the original job so admins can trace the chain.
  parentJobId: varchar("parent_job_id"),
  startedAt: timestamp("started_at").notNull().defaultNow(),
  completedAt: timestamp("completed_at"),
  heartbeatAt: timestamp("heartbeat_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  // Task #992 — remember the admin's originally-requested run knobs so a
  // resumed run after a server restart honors the same speed (concurrency)
  // and safety cap (maxRecords) instead of silently falling back to defaults.
  concurrency: integer("concurrency"),
  maxRecords: integer("max_records"),
  // Task #1070 — when a run is cancelled, remember which admin clicked
  // Cancel and (optionally) the free-text reason they typed in the
  // confirm dialog. Surfaced on the active job card, history rows, and
  // the run-completed Slack/email so admins can answer "who stopped this
  // and why" without grepping logs. NULL on COMPLETED/FAILED runs.
  cancelledById: varchar("cancelled_by_id").references(() => users.id, { onDelete: "set null" }),
  cancellationReason: text("cancellation_reason"),
}, (table) => ({
  orgIdx: index("crm_transcript_backfill_jobs_org_idx").on(table.organizationId),
  statusIdx: index("crm_transcript_backfill_jobs_status_idx").on(table.status),
  startedAtIdx: index("crm_transcript_backfill_jobs_started_at_idx").on(table.startedAt),
  parentJobIdx: index("crm_transcript_backfill_jobs_parent_idx").on(table.parentJobId),
}));
export const insertCrmTranscriptBackfillJobSchema = createInsertSchema(crmTranscriptBackfillJobs).omit({
  startedAt: true,
  updatedAt: true,
  heartbeatAt: true,
});
export type InsertCrmTranscriptBackfillJob = z.infer<typeof insertCrmTranscriptBackfillJobSchema>;
export type CrmTranscriptBackfillJob = typeof crmTranscriptBackfillJobs.$inferSelect;

// Task #1017 — per-organization destinations for transcript backfill alerts.
// Replaces the env-var fallback as the primary source so admins can configure
// the Slack webhook + email recipients from the in-app settings page instead
// of needing an ops change. One row per organization (PK = organizationId);
// missing rows mean "fall back to env vars".
export const crmTranscriptBackfillNotificationSettings = pgTable(
  "crm_transcript_backfill_notification_settings",
  {
    organizationId: varchar("organization_id")
      .primaryKey()
      .references(() => organizations.id, { onDelete: "cascade" }),
    slackWebhookUrl: text("slack_webhook_url"),
    emailRecipients: text("email_recipients")
      .array()
      .notNull()
      .default(sql`ARRAY[]::text[]`),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
    updatedById: varchar("updated_by_id").references(() => users.id, {
      onDelete: "set null",
    }),
    // Task #1045 — persist the most recent "Send test alert" outcome so admins
    // can see whether the configured destinations are healthy without firing
    // another test. `lastTestResult` shape mirrors the API response of the
    // POST /test-alert endpoint; `null` until the first test runs or after the
    // admin clears it.
    lastTestAt: timestamp("last_test_at"),
    lastTestResult: jsonb("last_test_result").$type<{
      slack: { configured: boolean; ok: boolean; error?: string };
      email: {
        configured: boolean;
        ok: boolean;
        error?: string;
        recipients?: string[];
      };
      operatorDisplay: string;
    } | null>(),
    // Task #1094 — admin-tunable threshold for the test-alert button. When the
    // number of test-alerts dispatched in the trailing 24h reaches this
    // value, a passive breach notification is fanned out via the same
    // backfill alert plumbing so runaway scripts/curious users get caught
    // even when nobody is actively watching `/admin/transcript-backfill`.
    // `null` falls back to the default in `transcriptBackfillNotifications.ts`.
    testAlertThresholdPerDay: integer("test_alert_threshold_per_day"),
    // Throttle ledger so a sustained breach can't spam the alert channel on
    // every subsequent click — we only re-notify after the throttle window.
    lastThresholdAlertAt: timestamp("last_threshold_alert_at"),
  },
);
export type CrmTranscriptBackfillNotificationSettings =
  typeof crmTranscriptBackfillNotificationSettings.$inferSelect;

// Task #1033 — audit trail for the admin "send test alert" button. Each row
// captures who clicked the button (org + user), when, and the per-channel
// result (Slack + email) so admins can see in-app who last triggered a test
// notification and whether it succeeded, instead of having to grep server
// logs.
export const crmTranscriptBackfillTestAlerts = pgTable(
  "crm_transcript_backfill_test_alerts",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    organizationId: varchar("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    sentById: varchar("sent_by_id").references(() => users.id, {
      onDelete: "set null",
    }),
    sentAt: timestamp("sent_at").notNull().defaultNow(),
    operatorDisplay: text("operator_display").notNull(),
    slackConfigured: boolean("slack_configured").notNull().default(false),
    slackOk: boolean("slack_ok").notNull().default(false),
    slackError: text("slack_error"),
    emailConfigured: boolean("email_configured").notNull().default(false),
    emailOk: boolean("email_ok").notNull().default(false),
    emailError: text("email_error"),
    emailRecipients: jsonb("email_recipients")
      .$type<string[]>()
      .notNull()
      .default([]),
  },
  (table) => ({
    orgSentAtIdx: index("crm_transcript_backfill_test_alerts_org_sent_at_idx").on(
      table.organizationId,
      table.sentAt,
    ),
  }),
);
export const insertCrmTranscriptBackfillTestAlertSchema = createInsertSchema(
  crmTranscriptBackfillTestAlerts,
).omit({ id: true, sentAt: true });
export type InsertCrmTranscriptBackfillTestAlert = z.infer<
  typeof insertCrmTranscriptBackfillTestAlertSchema
>;
export type CrmTranscriptBackfillTestAlert =
  typeof crmTranscriptBackfillTestAlerts.$inferSelect;

// Task #1031 — record every per-channel dispatch attempt for transcript
// backfill alerts so admins can confirm in-app that the most recent runs
// actually reached Slack/email. Failures are logged server-side too, but
// without this table they're invisible to the people who configured the
// destinations. One row per (job, channel, recipient batch).
export const crmTranscriptBackfillAlertDeliveries = pgTable(
  "crm_transcript_backfill_alert_deliveries",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    organizationId: varchar("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    jobId: varchar("job_id"),
    // 'slack' | 'email'
    channel: text("channel").notNull(),
    // 'success' | 'failure'
    status: text("status").notNull(),
    // Human-readable target summary: webhook host for Slack, comma-separated
    // recipient list (truncated) for email.
    recipientSummary: text("recipient_summary").notNull().default(""),
    errorMessage: text("error_message"),
    attemptedAt: timestamp("attempted_at").notNull().defaultNow(),
    // Task #1069 — provenance for delivery rows. `source='automatic'` is
    // anything written by the backfill worker's normal completion path;
    // `source='resend'` is a row written because an admin clicked the
    // Resend button on the in-app history. `triggeredById` holds the
    // acting admin's user id for resend rows so the UI can render
    // "Resent by Jane" alongside the new outcome (and stays NULL for
    // automatic dispatches so they keep rendering as they always did).
    triggeredById: varchar("triggered_by_id"),
    source: text("source").notNull().default("automatic"),
  },
  (table) => ({
    orgAttemptedIdx: index(
      "crm_transcript_backfill_alert_deliveries_org_attempted_idx",
    ).on(table.organizationId, table.attemptedAt),
    jobIdx: index("crm_transcript_backfill_alert_deliveries_job_idx").on(
      table.jobId,
    ),
  }),
);
export type CrmTranscriptBackfillAlertDelivery =
  typeof crmTranscriptBackfillAlertDeliveries.$inferSelect;
export const insertCrmTranscriptBackfillAlertDeliverySchema =
  createInsertSchema(crmTranscriptBackfillAlertDeliveries).omit({
    id: true,
    attemptedAt: true,
  });
export type InsertCrmTranscriptBackfillAlertDelivery = z.infer<
  typeof insertCrmTranscriptBackfillAlertDeliverySchema
>;

// CRM Quotes - lightweight proposals/quotes generated directly from opportunities
export const crmQuotes = pgTable("crm_quotes", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  opportunityId: varchar("opportunity_id").references(() => crmOpportunities.id, { onDelete: "set null" }),
  crmOrganisationId: varchar("crm_organisation_id").references(() => crmOrganisations.id, { onDelete: "set null" }),
  contactId: varchar("contact_id").references(() => crmContacts.id, { onDelete: "set null" }),
  quoteNumber: text("quote_number").notNull(),
  title: text("title").notNull(),
  status: text("status").notNull().default("DRAFT"),
  validUntil: date("valid_until"),
  subtotal: decimal("subtotal", { precision: 14, scale: 2 }).notNull().default("0"),
  taxRate: decimal("tax_rate", { precision: 5, scale: 2 }).notNull().default("0"),
  taxAmount: decimal("tax_amount", { precision: 14, scale: 2 }).notNull().default("0"),
  discountAmount: decimal("discount_amount", { precision: 14, scale: 2 }).notNull().default("0"),
  totalAmount: decimal("total_amount", { precision: 14, scale: 2 }).notNull().default("0"),
  notes: text("notes"),
  terms: text("terms"),
  approvalStatus: crmQuoteApprovalStatusEnum("approval_status").notNull().default("NOT_REQUIRED"),
  approvalId: varchar("approval_id"),
  createdById: varchar("created_by_id").references(() => users.id, { onDelete: "set null" }),
  sentAt: timestamp("sent_at"),
  acceptedAt: timestamp("accepted_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  orgIdx: index("crm_quotes_org_idx").on(table.organizationId),
  oppIdx: index("crm_quotes_opp_idx").on(table.opportunityId),
  statusIdx: index("crm_quotes_status_idx").on(table.status),
  numberIdx: index("crm_quotes_number_idx").on(table.organizationId, table.quoteNumber),
}));
export const insertCrmQuoteSchema = createInsertSchema(crmQuotes).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertCrmQuote = z.infer<typeof insertCrmQuoteSchema>;
export type CrmQuote = typeof crmQuotes.$inferSelect;

export const crmQuoteLineItems = pgTable("crm_quote_line_items", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  quoteId: varchar("quote_id").notNull().references(() => crmQuotes.id, { onDelete: "cascade" }),
  sortOrder: integer("sort_order").notNull().default(0),
  description: text("description").notNull(),
  quantity: decimal("quantity", { precision: 14, scale: 4 }).notNull().default("1"),
  unit: text("unit"),
  unitPrice: decimal("unit_price", { precision: 14, scale: 4 }).notNull().default("0"),
  lineTotal: decimal("line_total", { precision: 14, scale: 2 }).notNull().default("0"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  quoteIdx: index("crm_quote_line_items_quote_idx").on(table.quoteId),
}));
export const insertCrmQuoteLineItemSchema = createInsertSchema(crmQuoteLineItems).omit({ id: true, createdAt: true, lineTotal: true });
export type InsertCrmQuoteLineItem = z.infer<typeof insertCrmQuoteLineItemSchema>;
export type CrmQuoteLineItem = typeof crmQuoteLineItems.$inferSelect;

// CRM Tasks / Follow-ups - reminders attached to opportunities, orgs, or contacts
export const crmTasks = pgTable("crm_tasks", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  description: text("description"),
  dueDate: timestamp("due_date").notNull(),
  status: text("status").notNull().default("PENDING"),
  priority: text("priority").notNull().default("NORMAL"),
  assignedToId: varchar("assigned_to_id").references(() => users.id, { onDelete: "set null" }),
  opportunityId: varchar("opportunity_id").references(() => crmOpportunities.id, { onDelete: "cascade" }),
  crmOrganisationId: varchar("crm_organisation_id").references(() => crmOrganisations.id, { onDelete: "set null" }),
  contactId: varchar("contact_id").references(() => crmContacts.id, { onDelete: "set null" }),
  reminderSentAt: timestamp("reminder_sent_at"),
  completedAt: timestamp("completed_at"),
  createdById: varchar("created_by_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  orgIdx: index("crm_tasks_org_idx").on(table.organizationId),
  assignedIdx: index("crm_tasks_assigned_idx").on(table.assignedToId),
  dueDateIdx: index("crm_tasks_due_date_idx").on(table.dueDate),
  statusIdx: index("crm_tasks_status_idx").on(table.status),
  opportunityIdx: index("crm_tasks_opportunity_idx").on(table.opportunityId),
}));
export const insertCrmTaskSchema = createInsertSchema(crmTasks).omit({ id: true, createdAt: true, updatedAt: true, reminderSentAt: true, completedAt: true });
export type InsertCrmTask = z.infer<typeof insertCrmTaskSchema>;
export type CrmTask = typeof crmTasks.$inferSelect;

// CRM Auto-Assignment Rules - assign new opportunities/leads to users by territory/source/value
export const crmAssignmentRules = pgTable("crm_assignment_rules", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  priority: integer("priority").notNull().default(100),
  isActive: boolean("is_active").notNull().default(true),
  conditions: jsonb("conditions").notNull().default({}),
  assignmentType: text("assignment_type").notNull().default("USER"),
  assignedToId: varchar("assigned_to_id").references(() => users.id, { onDelete: "set null" }),
  roundRobinUserIds: jsonb("round_robin_user_ids").notNull().default([]),
  lastAssignedIndex: integer("last_assigned_index").notNull().default(-1),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  orgIdx: index("crm_assignment_rules_org_idx").on(table.organizationId),
  activeIdx: index("crm_assignment_rules_active_idx").on(table.organizationId, table.isActive, table.priority),
}));
export const insertCrmAssignmentRuleSchema = createInsertSchema(crmAssignmentRules).omit({ id: true, createdAt: true, updatedAt: true, lastAssignedIndex: true });
export type InsertCrmAssignmentRule = z.infer<typeof insertCrmAssignmentRuleSchema>;
export type CrmAssignmentRule = typeof crmAssignmentRules.$inferSelect;

// CRM Catalog Items - reusable line items for quotes
export const crmCatalogItems = pgTable("crm_catalog_items", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description"),
  category: text("category"),
  unit: text("unit"),
  unitPrice: decimal("unit_price", { precision: 14, scale: 4 }).notNull().default("0"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  orgIdx: index("crm_catalog_items_org_idx").on(table.organizationId),
  activeIdx: index("crm_catalog_items_active_idx").on(table.organizationId, table.isActive),
}));
export const insertCrmCatalogItemSchema = createInsertSchema(crmCatalogItems).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertCrmCatalogItem = z.infer<typeof insertCrmCatalogItemSchema>;
export type CrmCatalogItem = typeof crmCatalogItems.$inferSelect;

// CRM Quote Templates
export const crmQuoteTemplates = pgTable("crm_quote_templates", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description"),
  defaultTerms: text("default_terms"),
  defaultNotes: text("default_notes"),
  defaultTaxRate: decimal("default_tax_rate", { precision: 5, scale: 2 }).notNull().default("0"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  orgIdx: index("crm_quote_templates_org_idx").on(table.organizationId),
}));
export const insertCrmQuoteTemplateSchema = createInsertSchema(crmQuoteTemplates).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertCrmQuoteTemplate = z.infer<typeof insertCrmQuoteTemplateSchema>;
export type CrmQuoteTemplate = typeof crmQuoteTemplates.$inferSelect;

export const crmQuoteTemplateItems = pgTable("crm_quote_template_items", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  templateId: varchar("template_id").notNull().references(() => crmQuoteTemplates.id, { onDelete: "cascade" }),
  sortOrder: integer("sort_order").notNull().default(0),
  description: text("description").notNull(),
  quantity: decimal("quantity", { precision: 14, scale: 4 }).notNull().default("1"),
  unit: text("unit"),
  unitPrice: decimal("unit_price", { precision: 14, scale: 4 }).notNull().default("0"),
  catalogItemId: varchar("catalog_item_id").references(() => crmCatalogItems.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  tmplIdx: index("crm_quote_template_items_tmpl_idx").on(table.templateId),
}));
export const insertCrmQuoteTemplateItemSchema = createInsertSchema(crmQuoteTemplateItems).omit({ id: true, createdAt: true });
export type InsertCrmQuoteTemplateItem = z.infer<typeof insertCrmQuoteTemplateItemSchema>;
export type CrmQuoteTemplateItem = typeof crmQuoteTemplateItems.$inferSelect;

// CRM Quote Acceptance Tokens — public token for client to view + accept/decline a quote
export const crmQuoteAcceptanceTokens = pgTable("crm_quote_acceptance_tokens", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  quoteId: varchar("quote_id").notNull().references(() => crmQuotes.id, { onDelete: "cascade" }),
  tokenHash: varchar("token_hash").notNull().unique(),
  status: crmQuoteAcceptanceStatusEnum("status").notNull().default("PENDING"),
  expiresAt: timestamp("expires_at").notNull(),
  viewedAt: timestamp("viewed_at"),
  decidedAt: timestamp("decided_at"),
  signedName: text("signed_name"),
  signedEmail: text("signed_email"),
  declineReason: text("decline_reason"),
  ipAddress: varchar("ip_address"),
  userAgent: text("user_agent"),
  createdById: varchar("created_by_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  orgIdx: index("crm_quote_acc_tok_org_idx").on(table.organizationId),
  quoteIdx: index("crm_quote_acc_tok_quote_idx").on(table.quoteId),
}));
export const insertCrmQuoteAcceptanceTokenSchema = createInsertSchema(crmQuoteAcceptanceTokens).omit({ id: true, createdAt: true });
export type InsertCrmQuoteAcceptanceToken = z.infer<typeof insertCrmQuoteAcceptanceTokenSchema>;
export type CrmQuoteAcceptanceToken = typeof crmQuoteAcceptanceTokens.$inferSelect;

// CRM Lead Scoring Rules
export const crmLeadScoringRules = pgTable("crm_lead_scoring_rules", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  field: text("field").notNull(), // e.g. "source", "projectType", "dealValue", "projectLocation", "companyName"
  operator: crmLeadScoringOperatorEnum("operator").notNull(),
  value: text("value"), // string compared (or numeric for GTE/LTE)
  points: integer("points").notNull().default(0),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  orgIdx: index("crm_lead_scoring_rules_org_idx").on(table.organizationId),
  activeIdx: index("crm_lead_scoring_rules_active_idx").on(table.organizationId, table.isActive),
}));
export const insertCrmLeadScoringRuleSchema = createInsertSchema(crmLeadScoringRules).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertCrmLeadScoringRule = z.infer<typeof insertCrmLeadScoringRuleSchema>;
export type CrmLeadScoringRule = typeof crmLeadScoringRules.$inferSelect;

// =============================================================================
// CRM Email Logging (Task #886) — Two-way Gmail/Outlook → CRM activity sync
// =============================================================================
// Org-level setting controlling automatic email logging onto CRM contacts.
export const crmEmailLoggingSettings = pgTable("crm_email_logging_settings", {
  organizationId: varchar("organization_id").primaryKey().references(() => organizations.id, { onDelete: "cascade" }),
  // 'OFF' | 'MY_DOMAIN' | 'ALL'
  mode: text("mode").notNull().default("OFF"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
export const insertCrmEmailLoggingSettingsSchema = createInsertSchema(crmEmailLoggingSettings).omit({ createdAt: true, updatedAt: true });
export type InsertCrmEmailLoggingSettings = z.infer<typeof insertCrmEmailLoggingSettingsSchema>;
export type CrmEmailLoggingSettings = typeof crmEmailLoggingSettings.$inferSelect;

// Per-org suppression list. `pattern` may be a full address ("a@b.com") or a
// domain ("@example.com"). Anything matching is skipped by the logger.
export const crmEmailLoggingSuppressions = pgTable("crm_email_logging_suppressions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  pattern: text("pattern").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  orgIdx: index("crm_email_supp_org_idx").on(table.organizationId),
  orgPatUnique: uniqueIndex("crm_email_supp_org_pattern_uidx").on(table.organizationId, table.pattern),
}));
export const insertCrmEmailLoggingSuppressionSchema = createInsertSchema(crmEmailLoggingSuppressions).omit({ id: true, createdAt: true });
export type InsertCrmEmailLoggingSuppression = z.infer<typeof insertCrmEmailLoggingSuppressionSchema>;
export type CrmEmailLoggingSuppression = typeof crmEmailLoggingSuppressions.$inferSelect;

// CRM-owned email thread (denormalized from emailThreads/emailMessages so the
// CRM activity timeline can read without crossing into the AI inbox domain).
export const crmEmailThreads = pgTable("crm_email_threads", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  contactId: varchar("contact_id").references(() => crmContacts.id, { onDelete: "set null" }),
  opportunityId: varchar("opportunity_id").references(() => crmOpportunities.id, { onDelete: "set null" }),
  organisationId: varchar("organisation_id").references(() => crmOrganisations.id, { onDelete: "set null" }),
  subject: text("subject").notNull(),
  externalThreadId: text("external_thread_id"),
  provider: text("provider").notNull(), // 'GMAIL' | 'OUTLOOK'
  messageCount: integer("message_count").notNull().default(0),
  lastMessageAt: timestamp("last_message_at").notNull().defaultNow(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  orgIdx: index("crm_email_threads_org_idx").on(table.organizationId),
  contactIdx: index("crm_email_threads_contact_idx").on(table.contactId),
  oppIdx: index("crm_email_threads_opp_idx").on(table.opportunityId),
  externalUnique: uniqueIndex("crm_email_threads_org_ext_uidx").on(table.organizationId, table.externalThreadId),
}));
export const insertCrmEmailThreadSchema = createInsertSchema(crmEmailThreads).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertCrmEmailThread = z.infer<typeof insertCrmEmailThreadSchema>;
export type CrmEmailThread = typeof crmEmailThreads.$inferSelect;

// Individual CRM-logged email message. Idempotent on (orgId, externalMessageId,
// direction) so re-running the logger or backfill never duplicates rows.
export const crmEmailMessages = pgTable("crm_email_messages", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  threadId: varchar("thread_id").notNull().references(() => crmEmailThreads.id, { onDelete: "cascade" }),
  contactId: varchar("contact_id").references(() => crmContacts.id, { onDelete: "set null" }),
  opportunityId: varchar("opportunity_id").references(() => crmOpportunities.id, { onDelete: "set null" }),
  externalMessageId: text("external_message_id").notNull(),
  direction: text("direction").notNull(), // 'INBOUND' | 'OUTBOUND'
  fromAddress: text("from_address").notNull(),
  toAddresses: text("to_addresses"),
  ccAddresses: text("cc_addresses"),
  subject: text("subject").notNull(),
  snippet: text("snippet"),
  bodyText: text("body_text"),
  sentAt: timestamp("sent_at").notNull(),
  // Source row in emailMessages, when the message came in via Gmail/Outlook
  // sync. NULL is allowed for backfilled rows that pre-date the source row.
  sourceEmailMessageId: varchar("source_email_message_id").references(() => emailMessages.id, { onDelete: "set null" }),
  // Linked CRM activity row (created at the same time so the unified timeline
  // can render without an extra join). Multiple messages of the same direction
  // on the same thread share one activity row (aggregated, not per-message).
  activityId: varchar("activity_id").references(() => crmOpportunityActivities.id, { onDelete: "set null" }),
  // Provider deep-link back to the source message in Gmail/Outlook UI.
  providerDeepLink: text("provider_deep_link"),
  provider: text("provider"), // 'GMAIL' | 'OUTLOOK'
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  orgIdx: index("crm_email_messages_org_idx").on(table.organizationId),
  threadIdx: index("crm_email_messages_thread_idx").on(table.threadId),
  contactIdx: index("crm_email_messages_contact_idx").on(table.contactId),
  oppIdx: index("crm_email_messages_opp_idx").on(table.opportunityId),
  sentAtIdx: index("crm_email_messages_sent_at_idx").on(table.sentAt),
  externalUnique: uniqueIndex("crm_email_messages_org_ext_dir_uidx").on(table.organizationId, table.externalMessageId, table.direction),
}));
export const insertCrmEmailMessageSchema = createInsertSchema(crmEmailMessages).omit({ id: true, createdAt: true });
export type InsertCrmEmailMessage = z.infer<typeof insertCrmEmailMessageSchema>;
export type CrmEmailMessage = typeof crmEmailMessages.$inferSelect;


// ============================================
// CRM SEQUENCES & CADENCES
// ============================================
export const crmSequences = pgTable("crm_sequences", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description"),
  status: crmSequenceStatusEnum("status").notNull().default("DRAFT"),
  ownerId: varchar("owner_id").references(() => users.id, { onDelete: "set null" }),
  businessHoursOnly: boolean("business_hours_only").notNull().default(true),
  weekdaysOnly: boolean("weekdays_only").notNull().default(true),
  dailySendCap: integer("daily_send_cap").notNull().default(200),
  optimizedSendWindowStartHour: integer("optimized_send_window_start_hour").notNull().default(9),
  optimizedSendWindowEndHour: integer("optimized_send_window_end_hour").notNull().default(11),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  orgIdx: index("crm_sequences_org_idx").on(table.organizationId),
  statusIdx: index("crm_sequences_status_idx").on(table.status),
}));
export const insertCrmSequenceSchema = createInsertSchema(crmSequences).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertCrmSequence = z.infer<typeof insertCrmSequenceSchema>;
export type CrmSequence = typeof crmSequences.$inferSelect;

export const crmSequenceSteps = pgTable("crm_sequence_steps", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  sequenceId: varchar("sequence_id").notNull().references(() => crmSequences.id, { onDelete: "cascade" }),
  stepOrder: integer("step_order").notNull(),
  stepType: crmSequenceStepTypeEnum("step_type").notNull(),
  delayDays: integer("delay_days").notNull().default(0),
  sendHourLocal: integer("send_hour_local").notNull().default(9),
  subject: text("subject"),
  body: text("body"),
  instructions: text("instructions"),
  variantGroup: text("variant_group"),
  isWinner: boolean("is_winner").notNull().default(false),
  sendTimeOptimized: boolean("send_time_optimized").notNull().default(false),
  winningMetric: text("winning_metric"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  sequenceIdx: index("crm_sequence_steps_seq_idx").on(table.sequenceId),
  orderIdx: index("crm_sequence_steps_order_idx").on(table.sequenceId, table.stepOrder),
  variantIdx: index("crm_sequence_steps_variant_idx").on(table.sequenceId, table.variantGroup),
}));
export const insertCrmSequenceStepSchema = createInsertSchema(crmSequenceSteps).omit({ id: true, createdAt: true });
export type InsertCrmSequenceStep = z.infer<typeof insertCrmSequenceStepSchema>;
export type CrmSequenceStep = typeof crmSequenceSteps.$inferSelect;

export const crmSequenceEnrollments = pgTable("crm_sequence_enrollments", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  sequenceId: varchar("sequence_id").notNull().references(() => crmSequences.id, { onDelete: "cascade" }),
  contactId: varchar("contact_id").references(() => crmContacts.id, { onDelete: "cascade" }),
  opportunityId: varchar("opportunity_id").references(() => crmOpportunities.id, { onDelete: "set null" }),
  senderId: varchar("sender_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  status: crmSequenceEnrollmentStatusEnum("status").notNull().default("ACTIVE"),
  currentStepIndex: integer("current_step_index").notNull().default(0),
  startAt: timestamp("start_at").notNull().defaultNow(),
  exitReason: crmSequenceExitReasonEnum("exit_reason"),
  exitedAt: timestamp("exited_at"),
  // When the enrollment exits with reason BOUNCED, points at the inbound DSN
  // email message so the UI can link the user to the underlying bounce.
  bounceEmailMessageId: varchar("bounce_email_message_id").references(() => emailMessages.id, { onDelete: "set null" }),
  lastActivityAt: timestamp("last_activity_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  orgIdx: index("crm_seq_enroll_org_idx").on(table.organizationId),
  seqIdx: index("crm_seq_enroll_seq_idx").on(table.sequenceId),
  contactIdx: index("crm_seq_enroll_contact_idx").on(table.contactId),
  oppIdx: index("crm_seq_enroll_opp_idx").on(table.opportunityId),
  senderIdx: index("crm_seq_enroll_sender_idx").on(table.senderId),
  statusIdx: index("crm_seq_enroll_status_idx").on(table.status),
  uniqueActiveContact: uniqueIndex("crm_seq_enroll_unique_contact").on(table.sequenceId, table.contactId),
}));
export const insertCrmSequenceEnrollmentSchema = createInsertSchema(crmSequenceEnrollments).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertCrmSequenceEnrollment = z.infer<typeof insertCrmSequenceEnrollmentSchema>;
export type CrmSequenceEnrollment = typeof crmSequenceEnrollments.$inferSelect;

export const crmSequenceStepExecutions = pgTable("crm_sequence_step_executions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  enrollmentId: varchar("enrollment_id").notNull().references(() => crmSequenceEnrollments.id, { onDelete: "cascade" }),
  stepId: varchar("step_id").notNull().references(() => crmSequenceSteps.id, { onDelete: "cascade" }),
  stepOrder: integer("step_order").notNull(),
  scheduledAt: timestamp("scheduled_at").notNull(),
  sentAt: timestamp("sent_at"),
  completedAt: timestamp("completed_at"),
  taskId: varchar("task_id").references(() => crmTasks.id, { onDelete: "set null" }),
  status: crmSequenceExecutionStatusEnum("status").notNull().default("PENDING"),
  errorMessage: text("error_message"),
  attemptCount: integer("attempt_count").notNull().default(0),
  outboundMessageId: text("outbound_message_id"),
  selectedVariantId: varchar("selected_variant_id"),
  openCount: integer("open_count").notNull().default(0),
  clickCount: integer("click_count").notNull().default(0),
  repliedAt: timestamp("replied_at"),
  bouncedAt: timestamp("bounced_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  orgIdx: index("crm_seq_exec_org_idx").on(table.organizationId),
  enrollIdx: index("crm_seq_exec_enroll_idx").on(table.enrollmentId),
  stepIdx: index("crm_seq_exec_step_idx").on(table.stepId),
  scheduledIdx: index("crm_seq_exec_scheduled_idx").on(table.scheduledAt),
  statusIdx: index("crm_seq_exec_status_idx").on(table.status),
}));
export const insertCrmSequenceStepExecutionSchema = createInsertSchema(crmSequenceStepExecutions).omit({ id: true, createdAt: true });
export type InsertCrmSequenceStepExecution = z.infer<typeof insertCrmSequenceStepExecutionSchema>;
export type CrmSequenceStepExecution = typeof crmSequenceStepExecutions.$inferSelect;

export const crmSequenceEmailEvents = pgTable("crm_sequence_email_events", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  executionId: varchar("execution_id").notNull().references(() => crmSequenceStepExecutions.id, { onDelete: "cascade" }),
  eventType: crmSequenceEmailEventTypeEnum("event_type").notNull(),
  payload: jsonb("payload").notNull().default({}),
  occurredAt: timestamp("occurred_at").notNull().defaultNow(),
}, (table) => ({
  execIdx: index("crm_seq_email_events_exec_idx").on(table.executionId),
  typeIdx: index("crm_seq_email_events_type_idx").on(table.eventType),
}));
export const insertCrmSequenceEmailEventSchema = createInsertSchema(crmSequenceEmailEvents).omit({ id: true, occurredAt: true });
export type InsertCrmSequenceEmailEvent = z.infer<typeof insertCrmSequenceEmailEventSchema>;
export type CrmSequenceEmailEvent = typeof crmSequenceEmailEvents.$inferSelect;