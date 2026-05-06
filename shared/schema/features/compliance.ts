// AUTO-GENERATED SPLIT FROM shared/schema/features.ts (Task #2426).
// Domain bucketing rule lives in shared/schema/features/index.ts.
import { sql } from "drizzle-orm";
import { pgTable, text, varchar, boolean, timestamp, date, decimal, integer, pgEnum, doublePrecision, index, unique, uniqueIndex, json, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod";
import { addendumRecipientTypeEnum, addendumStatusEnum, aiBidDocumentAnalysisStatusEnum, aiCoDraftStatusEnum, aiContractDocumentAnalysisStatusEnum, contractStatusEnum, contractTypeEnum, contractRedlineStatusEnum, contractApprovalDecisionEnum, clauseCategoryEnum, signatureRequestStatusEnum, signerStatusEnum, aiInsightModuleEnum, aiInsightSeverityEnum, aiTakeoffModeEnum, aiTakeoffStatusEnum, aiTakeoffSuggestionStatusEnum, aiTakeoffRejectReasonEnum, aiTaskPriorityEnum, aiTaskStatusEnum, approvalEntityTypeEnum, approvalStatusEnum, atsProviderEnum, bidEquipmentSourceEnum, bidInvitationStatusEnum, bidRequestStatusEnum, bidResponseStatusEnum, blogCommentStatusEnum, blogPostStatusEnum, conversationTypeEnum, crewAvailabilityStatusEnum, crmActivityTypeEnum, crmCallDirectionEnum, crmCallOutcomeEnum, crmCallStatusEnum, crmCustomFieldEntityEnum, crmCustomFieldTypeEnum, crmContactRoleEnum, crmNoteTypeEnum, crmOrgStatusEnum, crmOrganisationTypeEnum, crmPipelineStageEnum, crmPreferredContactEnum, crmLostCategoryEnum, crmQuoteAcceptanceStatusEnum, crmLeadScoringOperatorEnum, crmSequenceStatusEnum, crmSequenceStepTypeEnum, crmSequenceEnrollmentStatusEnum, crmSequenceExecutionStatusEnum, crmSequenceEmailEventTypeEnum, crmSequenceExitReasonEnum, crmQuoteApprovalStatusEnum, dataSubjectRequestStatusEnum, dataSubjectRequestTypeEnum, documentRevisionSourceEnum, documentRevisionStatusEnum, emailClassificationEnum, emailProviderEnum, emailTaskSourceEnum, emailThreadStatusEnum, hiringActivityTypeEnum, hiringCandidateStageEnum, hiringCompensationTypeEnum, hiringEmploymentTypeEnum, hiringInterviewStatusEnum, hiringJobStatusEnum, hiringSyncStatusEnum, hustlerDelegateRoleEnum, hustlerLinkRequestStatusEnum, installationStatusEnum, lidarScanStatusEnum, lidarAnnotationTypeEnum, lidarComparisonTypeEnum, unifiedPaymentMethodEnum, unifiedPaymentStatusEnum, invoiceTypeEnum, integrationConnectionStatusEnum, integrationEventStatusEnum, integrationProviderEnum, issueSeverityEnum, issueStatusEnum, jobsiteAnalysisStatusEnum, lienWaiverStatusEnum, lienWaiverTypeEnum, locationLevelEnum, maintenanceTypeEnum, measurementReviewStatusEnum, measurementSourceEnum, measurementStatusEnum, measurementTypeEnum, takeoffVersionStatusEnum, messageEntityTypeEnum, mobilePlatformEnum, offlineEntityTypeEnum, offlineOperationTypeEnum, offlineSyncStatusEnum, organizationDocumentTypeEnum, organizationDocumentVisibilityEnum, overheadCostActionEnum, overheadCostCategoryEnum, overheadCostFrequencyEnum, portalChatPriorityEnum, portalChatThreadCategoryEnum, portalChatThreadStatusEnum, pricebookImportJobStatusEnum, pricebookStatusEnum, pricingApprovalStatusEnum, pricingSourceTypeEnum, projectEquipmentPlanStatusEnum, repairStatusEnum, retentionActionEnum, retentionEntityTypeEnum, rewardTypeEnum, rfiCategoryEnum, rfiPriorityEnum, rfiStatusEnum, scheduleDependencyTypeEnum, scheduleGeneratedByEnum, scheduleTaskStatusEnum, socialAccountStatusEnum, socialPlatformEnum, socialPostStatusEnum, sovPaymentMethodEnum, sovStatusEnum, storedMaterialStatusEnum, retentionReleaseTypeEnum, retentionReleaseStatusEnum, sowAuditActionEnum, ssoProviderEnum, submittalCategoryEnum, submittalItemStatusEnum, submittalPhaseEnum, submittalReviewRoleEnum, submittalReviewStatusEnum, submittalStatusEnum, submittalTypeEnum, syncStatusEnum, tradeTypeEnum, transmittalStatusEnum, userRoleEnum, vendorEnrollmentStatusEnum, voiceLogStatusEnum, websiteDeploymentActionEnum, websitePageTypeEnum, websiteProjectStatusEnum, websiteStatusEnum, takeoffIssueCategoryEnum, takeoffIssueStatusEnum, talentAvailabilityEnum, talentProfileVisibilityEnum, workflowEntityTypeEnum, riskCategoryEnum, riskStatusEnum, workflowTemplateStatusEnum, workflowInstanceStatusEnum, videoCallStatusEnum, workflowNotificationChannelEnum, dotAgencyKindEnum, dotPayItemTypeEnum, dbeCertificationTypeEnum, suretyBondTypeEnum, suretyBondStatusEnum, haulTicketStatusEnum, swpppInspectionTypeEnum, idrStatusEnum, buyAmericaStatusEnum } from "../enums";
import { bids, organizations, projects, users } from "../core";
import { changeOrders, estimateLineItems, estimates, planDocuments, projectInspections, tasks, tmTickets } from "../operations";
import { objectAclPolicies } from "./org_catalog";



// Table 5: ai_action_audit
export const aiActionAudit = pgTable("ai_action_audit", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  actorUserId: varchar("actor_user_id").references(() => users.id),
  actionType: text("action_type").notNull(),
  model: text("model"),
  tokensIn: integer("tokens_in"),
  tokensOut: integer("tokens_out"),
  costEstimate: decimal("cost_estimate", { precision: 10, scale: 6 }),
  inputRefs: json("input_refs"),
  outputRefs: json("output_refs"),
  rationale: text("rationale"),
  approvalRequired: boolean("approval_required").notNull().default(false),
  approvalStatus: text("approval_status"),
  approvedByUserId: varchar("approved_by_user_id").references(() => users.id),
  approvedAt: timestamp("approved_at"),
  durationMs: integer("duration_ms"),
  // Task #2410: per-call provider attribution + fallback audit. `provider`
  // and `fallbackUsed` are nullable for backward compatibility with rows
  // written before the multi-provider rollout (those rows are openai by
  // construction since the router didn't exist yet).
  provider: text("provider"),
  fallbackUsed: boolean("fallback_used").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  orgIdx: index("ai_action_audit_org_idx").on(table.organizationId),
  actorIdx: index("ai_action_audit_actor_idx").on(table.actorUserId),
  actionTypeIdx: index("ai_action_audit_action_type_idx").on(table.actionType),
  createdAtIdx: index("ai_action_audit_created_at_idx").on(table.createdAt),
  providerIdx: index("ai_action_audit_provider_idx").on(table.provider),
}));

export const insertAiActionAuditSchema = createInsertSchema(aiActionAudit).omit({ id: true, createdAt: true });
export type InsertAiActionAudit = z.infer<typeof insertAiActionAuditSchema>;
export type AiActionAudit = typeof aiActionAudit.$inferSelect;

// Table 6: approval_requests
export const approvalRequests = pgTable("approval_requests", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  entityType: approvalEntityTypeEnum("entity_type").notNull(),
  entityId: varchar("entity_id").notNull(),
  requestedByUserId: varchar("requested_by_user_id").notNull().references(() => users.id),
  status: approvalStatusEnum("status").notNull().default("pending"),
  approverUserId: varchar("approver_user_id").references(() => users.id),
  approverRole: text("approver_role"),
  notes: text("notes"),
  decidedAt: timestamp("decided_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  orgIdx: index("approval_requests_org_idx").on(table.organizationId),
  entityIdx: index("approval_requests_entity_idx").on(table.entityType, table.entityId),
  statusIdx: index("approval_requests_status_idx").on(table.status),
  requestedByIdx: index("approval_requests_requested_by_idx").on(table.requestedByUserId),
}));

export const insertApprovalRequestSchema = createInsertSchema(approvalRequests).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertApprovalRequest = z.infer<typeof insertApprovalRequestSchema>;
export type ApprovalRequest = typeof approvalRequests.$inferSelect;

// Table 7: document_revisions
export const documentRevisions = pgTable("document_revisions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  documentId: varchar("document_id").notNull(),
  revisionNumber: integer("revision_number").notNull(),
  sourceType: documentRevisionSourceEnum("source_type").notNull().default("upload"),
  supersedesRevisionId: varchar("supersedes_revision_id"),
  status: documentRevisionStatusEnum("status").notNull().default("active"),
  storageKey: text("storage_key"),
  checksum: text("checksum"),
  metadata: json("metadata"),
  createdByUserId: varchar("created_by_user_id").references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  orgIdx: index("document_revisions_org_idx").on(table.organizationId),
  docIdx: index("document_revisions_doc_idx").on(table.documentId),
  docRevisionIdx: unique("document_revisions_doc_rev").on(table.documentId, table.revisionNumber),
}));

export const insertDocumentRevisionSchema = createInsertSchema(documentRevisions).omit({ id: true, createdAt: true });
export type InsertDocumentRevision = z.infer<typeof insertDocumentRevisionSchema>;
export type DocumentRevision = typeof documentRevisions.$inferSelect;

// Addenda tables
export const addenda = pgTable("addenda", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  addendumNumber: integer("addendum_number").notNull(),
  title: text("title").notNull(),
  description: text("description"),
  issuedDate: timestamp("issued_date"),
  issuedById: varchar("issued_by_id").references(() => users.id),
  relatedDocumentId: varchar("related_document_id").references(() => planDocuments.id, { onDelete: "set null" }),
  storageKey: text("storage_key"),
  fileUrl: text("file_url"),
  fileName: text("file_name"),
  status: addendumStatusEnum("status").notNull().default("DRAFT"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  orgIdx: index("addenda_org_idx").on(table.organizationId),
  projectIdx: index("addenda_project_idx").on(table.projectId),
  projectNumUnique: unique("addenda_project_num_unique").on(table.projectId, table.addendumNumber),
}));

export const insertAddendumSchema = createInsertSchema(addenda).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertAddendum = z.infer<typeof insertAddendumSchema>;
export type Addendum = typeof addenda.$inferSelect;

export const addendumAcknowledgments = pgTable("addendum_acknowledgments", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  addendumId: varchar("addendum_id").notNull().references(() => addenda.id, { onDelete: "cascade" }),
  recipientType: addendumRecipientTypeEnum("recipient_type").notNull(),
  recipientId: varchar("recipient_id"),
  recipientName: text("recipient_name").notNull(),
  recipientEmail: text("recipient_email"),
  sentAt: timestamp("sent_at").defaultNow(),
  acknowledgedAt: timestamp("acknowledged_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  addendumIdx: index("ack_addendum_idx").on(table.addendumId),
}));

export const insertAddendumAcknowledgmentSchema = createInsertSchema(addendumAcknowledgments).omit({ id: true, createdAt: true });
export type InsertAddendumAcknowledgment = z.infer<typeof insertAddendumAcknowledgmentSchema>;
export type AddendumAcknowledgment = typeof addendumAcknowledgments.$inferSelect;

// ============================================================================
// Enterprise Procurement Readiness Tables
// ============================================================================

// SSO Provider enum
export const ssoConfigurations = pgTable("sso_configurations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  provider: ssoProviderEnum("provider").notNull(),
  entityId: text("entity_id").notNull(),
  ssoLoginUrl: text("sso_login_url").notNull(),
  certificate: text("certificate").notNull(),
  metadataUrl: text("metadata_url"),
  enforceSSO: boolean("enforce_sso").notNull().default(false),
  enabled: boolean("enabled").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  orgIdx: index("sso_config_org_idx").on(table.organizationId),
}));

export const insertSsoConfigurationSchema = createInsertSchema(ssoConfigurations).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertSsoConfiguration = z.infer<typeof insertSsoConfigurationSchema>;
export type SsoConfiguration = typeof ssoConfigurations.$inferSelect;

// Table: active_sessions
export const activeSessions = pgTable("active_sessions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  deviceInfo: text("device_info"),
  lastActivityAt: timestamp("last_activity_at").notNull().defaultNow(),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  userIdx: index("active_sessions_user_idx").on(table.userId),
  expiresIdx: index("active_sessions_expires_idx").on(table.expiresAt),
}));

export const insertActiveSessionSchema = createInsertSchema(activeSessions).omit({ id: true, createdAt: true });
export type InsertActiveSession = z.infer<typeof insertActiveSessionSchema>;
export type ActiveSession = typeof activeSessions.$inferSelect;

// Retention policy enums
export const retentionPolicies = pgTable("retention_policies", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  entityType: retentionEntityTypeEnum("entity_type").notNull(),
  retentionDays: integer("retention_days").notNull(),
  action: retentionActionEnum("action").notNull().default("ARCHIVE"),
  enabled: boolean("enabled").notNull().default(true),
  lastRunAt: timestamp("last_run_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  orgIdx: index("retention_policies_org_idx").on(table.organizationId),
  orgEntityIdx: unique("retention_policies_org_entity").on(table.organizationId, table.entityType),
}));

export const insertRetentionPolicySchema = createInsertSchema(retentionPolicies).omit({ id: true, createdAt: true, updatedAt: true, lastRunAt: true });
export type InsertRetentionPolicy = z.infer<typeof insertRetentionPolicySchema>;
export type RetentionPolicy = typeof retentionPolicies.$inferSelect;

// Task #1552 / #1572 — the retention sweep in `server/jobs/jobRunner.ts`
// only has a real implementation for the (entityType, action) pairs in
// this list. Anything outside it is a no-op at sweep time, so we
// surface it as a warning + `policiesUnsupported` counter on the
// backend, and flag the combo on the admin UI so operators don't
// silently configure a no-op policy. Keep this in sync with
// `processRetentionPolicies`.
export const SUPPORTED_RETENTION_POLICY_COMBOS: ReadonlyArray<{
  entityType: (typeof retentionEntityTypeEnum.enumValues)[number];
  action: (typeof retentionActionEnum.enumValues)[number];
}> = [
  { entityType: "AUDIT_LOGS", action: "DELETE" },
  { entityType: "AI_ACTIONS", action: "DELETE" },
  { entityType: "AI_ACTIONS", action: "ANONYMIZE" },
  { entityType: "DOCUMENTS", action: "DELETE" },
  { entityType: "TIME_ENTRIES", action: "DELETE" },
  { entityType: "TIME_ENTRIES", action: "ANONYMIZE" },
  { entityType: "MESSAGES", action: "DELETE" },
  { entityType: "MESSAGES", action: "ANONYMIZE" },
  { entityType: "FILE_UPLOADS", action: "DELETE" },
];

export function isSupportedRetentionPolicyCombo(
  entityType: string,
  action: string,
): boolean {
  return SUPPORTED_RETENTION_POLICY_COMBOS.some(
    (c) => c.entityType === entityType && c.action === action,
  );
}

// Data subject request enums
export const dataProcessingRecords = pgTable("data_processing_records", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  purpose: text("purpose").notNull(),
  legalBasis: text("legal_basis").notNull(),
  dataCategories: json("data_categories"),
  recipients: json("recipients"),
  retentionPeriod: text("retention_period"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  orgIdx: index("data_processing_records_org_idx").on(table.organizationId),
}));

export const insertDataProcessingRecordSchema = createInsertSchema(dataProcessingRecords).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertDataProcessingRecord = z.infer<typeof insertDataProcessingRecordSchema>;
export type DataProcessingRecord = typeof dataProcessingRecords.$inferSelect;

// Table: data_subject_requests
export const dataSubjectRequests = pgTable("data_subject_requests", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  requestType: dataSubjectRequestTypeEnum("request_type").notNull(),
  subjectEmail: text("subject_email").notNull(),
  subjectName: text("subject_name"),
  status: dataSubjectRequestStatusEnum("status").notNull().default("PENDING"),
  requestedAt: timestamp("requested_at").notNull().defaultNow(),
  completedAt: timestamp("completed_at"),
  completedBy: varchar("completed_by").references(() => users.id),
  notes: text("notes"),
  exportFileKey: text("export_file_key"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  orgIdx: index("data_subject_requests_org_idx").on(table.organizationId),
  statusIdx: index("data_subject_requests_status_idx").on(table.status),
}))

export const insertDataSubjectRequestSchema = createInsertSchema(dataSubjectRequests).omit({ id: true, createdAt: true, requestedAt: true, completedAt: true });
export type InsertDataSubjectRequest = z.infer<typeof insertDataSubjectRequestSchema>;
export type DataSubjectRequest = typeof dataSubjectRequests.$inferSelect;
export type ObjectAclPolicyRecord = typeof objectAclPolicies.$inferSelect;

export const passkeyCredentials = pgTable("passkey_credentials", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  credentialId: text("credential_id").notNull().unique(),
  publicKey: text("public_key").notNull(),
  counter: integer("counter").notNull().default(0),
  transports: text("transports").array(),
  deviceName: text("device_name"),
  // Task #2190 — domain (RP ID) the credential was registered under.
  // WebAuthn permanently binds a credential to its registration rpID, so we
  // persist it here and (a) verify against the credential's own rpID rather
  // than a global one, and (b) surface it in the settings list so users can
  // identify stale passkeys created on a now-defunct dev URL. NULL on rows
  // created before this column existed — those legacy rows are surfaced in
  // settings as "unknown domain" and refuse to authenticate, forcing the
  // user to re-register.
  rpId: text("rp_id"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  userIdx: index("passkey_credentials_user_idx").on(table.userId),
  credentialIdx: index("passkey_credentials_credential_idx").on(table.credentialId),
}));

export const insertPasskeyCredentialSchema = createInsertSchema(passkeyCredentials).omit({ id: true, createdAt: true });
export type InsertPasskeyCredential = z.infer<typeof insertPasskeyCredentialSchema>;
export type PasskeyCredential = typeof passkeyCredentials.$inferSelect;

// ==================== Risk Management ====================

export const projectRisks = pgTable("project_risks", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  description: text("description"),
  category: riskCategoryEnum("category").notNull().default("OTHER"),
  probability: integer("probability").notNull().default(1),
  impact: integer("impact").notNull().default(1),
  riskScore: integer("risk_score").notNull().default(1),
  status: riskStatusEnum("status").notNull().default("IDENTIFIED"),
  mitigationPlan: text("mitigation_plan"),
  ownerUserId: varchar("owner_user_id").references(() => users.id, { onDelete: "set null" }),
  costImpactDollars: decimal("cost_impact_dollars", { precision: 12, scale: 2 }),
  scheduleImpactDays: integer("schedule_impact_days"),
  linkedCostCode: varchar("linked_cost_code"),
  linkedMilestone: varchar("linked_milestone"),
  linkedChangeOrderId: varchar("linked_change_order_id").references(() => changeOrders.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  projectIdx: index("project_risks_project_idx").on(table.projectId),
  orgIdx: index("project_risks_org_idx").on(table.organizationId),
  statusIdx: index("project_risks_status_idx").on(table.status),
  categoryIdx: index("project_risks_category_idx").on(table.category),
}));

export const insertProjectRiskSchema = createInsertSchema(projectRisks).omit({ id: true, createdAt: true, updatedAt: true, riskScore: true });
export type InsertProjectRisk = z.infer<typeof insertProjectRiskSchema>;
export type ProjectRisk = typeof projectRisks.$inferSelect;

export const platformAnnouncements = pgTable("platform_announcements", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  title: varchar("title", { length: 255 }).notNull(),
  message: text("message").notNull(),
  targetOrgIds: text("target_org_ids").array(),
  isActive: boolean("is_active").default(true).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  expiresAt: timestamp("expires_at"),
  createdById: text("created_by_id").references(() => users.id),
}, (table) => ({
  activeIdx: index("platform_announcements_active_idx").on(table.isActive),
}));

export const insertPlatformAnnouncementSchema = createInsertSchema(platformAnnouncements).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertPlatformAnnouncement = z.infer<typeof insertPlatformAnnouncementSchema>;
export type PlatformAnnouncement = typeof platformAnnouncements.$inferSelect;

export const userApiKeys = pgTable("user_api_keys", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  keyHash: text("key_hash").notNull(),
  keyPrefix: varchar("key_prefix", { length: 12 }).notNull(),
  keySuffix: varchar("key_suffix", { length: 4 }).notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  lastUsedAt: timestamp("last_used_at"),
}, (table) => ({
  userIdx: index("user_api_keys_user_idx").on(table.userId),
}));

export const insertUserApiKeySchema = createInsertSchema(userApiKeys).omit({ id: true, createdAt: true, lastUsedAt: true });
export type InsertUserApiKey = z.infer<typeof insertUserApiKeySchema>;
export type UserApiKey = typeof userApiKeys.$inferSelect;

export const userTotpSecrets = pgTable("user_totp_secrets", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }).unique(),
  secretHash: text("secret_hash").notNull(),
  backupCodesHash: text("backup_codes_hash").notNull(),
  enabled: boolean("enabled").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  verifiedAt: timestamp("verified_at"),
}, (table) => ({
  userIdx: index("user_totp_secrets_user_idx").on(table.userId),
}));

export const insertUserTotpSecretSchema = createInsertSchema(userTotpSecrets).omit({ id: true, createdAt: true, verifiedAt: true });
export type InsertUserTotpSecret = z.infer<typeof insertUserTotpSecretSchema>;
export type UserTotpSecret = typeof userTotpSecrets.$inferSelect;

export const userSessions = pgTable("user_sessions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  userAgent: text("user_agent"),
  ipAddress: text("ip_address"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  lastActiveAt: timestamp("last_active_at").notNull().defaultNow(),
  revokedAt: timestamp("revoked_at"),
}, (table) => ({
  userIdx: index("user_sessions_user_idx").on(table.userId),
}));

export const insertUserSessionSchema = createInsertSchema(userSessions).omit({ id: true, createdAt: true, lastActiveAt: true, revokedAt: true });
export type InsertUserSession = z.infer<typeof insertUserSessionSchema>;
export type UserSession = typeof userSessions.$inferSelect;

export const announcementDismissals = pgTable("announcement_dismissals", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  announcementId: text("announcement_id").notNull().references(() => platformAnnouncements.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  dismissedAt: timestamp("dismissed_at").defaultNow().notNull(),
}, (table) => ({
  uniqueDismissal: unique("announcement_dismissal_unique").on(table.announcementId, table.userId),
  announcementIdx: index("announcement_dismissals_ann_idx").on(table.announcementId),
  userIdx: index("announcement_dismissals_user_idx").on(table.userId),
}));

export const errorLogs = pgTable("error_logs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  level: text("level").notNull().default("error"),
  message: text("message").notNull(),
  stack: text("stack"),
  method: text("method"),
  path: text("path"),
  statusCode: integer("status_code"),
  userId: varchar("user_id"),
  organizationId: varchar("organization_id"),
  requestId: text("request_id"),
  userAgent: text("user_agent"),
  ip: text("ip"),
  metadata: text("metadata"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  createdAtIdx: index("error_logs_created_at_idx").on(table.createdAt),
  levelIdx: index("error_logs_level_idx").on(table.level),
  userIdIdx: index("error_logs_user_id_idx").on(table.userId),
}));

export type ErrorLog = typeof errorLogs.$inferSelect;

// ============================================================
// RATE LIMIT STATE (Task #1831)
// ============================================================
// Cross-replica backing store for the per-key debounces that previously
// lived in module-level Maps (e.g. the per-schedule "Send now" debounce
// and the per-org "Send test digest" debounce on the project-log-email
// settings card). A module-level Map is fine on a single Node process
// but silently breaks the moment the deployment runs more than one
// replica — each replica has its own Map, so a frantic click could fan
// out N test digests instead of one. This table is the shared store
// each replica writes to so a single Postgres `INSERT ... ON CONFLICT`
// statement can atomically gate the next attempt.
//
// `key` is opaque to the table — callers prefix their own namespace
// (e.g. `send-now:<schedule-id>`, `test-digest:<org-id>`) so distinct
// debounces can't collide. `last_invoked_at` is the timestamp of the
// most recent successful claim; the helper compares it against
// `now() - <window>` to decide whether the new attempt is allowed.
export const rateLimitState = pgTable("rate_limit_state", {
  key: text("key").primaryKey(),
  lastInvokedAt: timestamp("last_invoked_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
export type RateLimitState = typeof rateLimitState.$inferSelect;