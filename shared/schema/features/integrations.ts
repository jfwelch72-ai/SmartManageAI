// AUTO-GENERATED SPLIT FROM shared/schema/features.ts (Task #2426).
// Domain bucketing rule lives in shared/schema/features/index.ts.
import { sql } from "drizzle-orm";
import { pgTable, text, varchar, boolean, timestamp, date, decimal, integer, pgEnum, doublePrecision, index, unique, uniqueIndex, json, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod";
import { addendumRecipientTypeEnum, addendumStatusEnum, aiBidDocumentAnalysisStatusEnum, aiCoDraftStatusEnum, aiContractDocumentAnalysisStatusEnum, contractStatusEnum, contractTypeEnum, contractRedlineStatusEnum, contractApprovalDecisionEnum, clauseCategoryEnum, signatureRequestStatusEnum, signerStatusEnum, aiInsightModuleEnum, aiInsightSeverityEnum, aiTakeoffModeEnum, aiTakeoffStatusEnum, aiTakeoffSuggestionStatusEnum, aiTakeoffRejectReasonEnum, aiTaskPriorityEnum, aiTaskStatusEnum, approvalEntityTypeEnum, approvalStatusEnum, atsProviderEnum, bidEquipmentSourceEnum, bidInvitationStatusEnum, bidRequestStatusEnum, bidResponseStatusEnum, blogCommentStatusEnum, blogPostStatusEnum, conversationTypeEnum, crewAvailabilityStatusEnum, crmActivityTypeEnum, crmCallDirectionEnum, crmCallOutcomeEnum, crmCallStatusEnum, crmCustomFieldEntityEnum, crmCustomFieldTypeEnum, crmContactRoleEnum, crmNoteTypeEnum, crmOrgStatusEnum, crmOrganisationTypeEnum, crmPipelineStageEnum, crmPreferredContactEnum, crmLostCategoryEnum, crmQuoteAcceptanceStatusEnum, crmLeadScoringOperatorEnum, crmSequenceStatusEnum, crmSequenceStepTypeEnum, crmSequenceEnrollmentStatusEnum, crmSequenceExecutionStatusEnum, crmSequenceEmailEventTypeEnum, crmSequenceExitReasonEnum, crmQuoteApprovalStatusEnum, dataSubjectRequestStatusEnum, dataSubjectRequestTypeEnum, documentRevisionSourceEnum, documentRevisionStatusEnum, emailClassificationEnum, emailProviderEnum, emailTaskSourceEnum, emailThreadStatusEnum, hiringActivityTypeEnum, hiringCandidateStageEnum, hiringCompensationTypeEnum, hiringEmploymentTypeEnum, hiringInterviewStatusEnum, hiringJobStatusEnum, hiringSyncStatusEnum, hustlerDelegateRoleEnum, hustlerLinkRequestStatusEnum, installationStatusEnum, lidarScanStatusEnum, lidarAnnotationTypeEnum, lidarComparisonTypeEnum, unifiedPaymentMethodEnum, unifiedPaymentStatusEnum, invoiceTypeEnum, integrationConnectionStatusEnum, integrationEventStatusEnum, integrationProviderEnum, issueSeverityEnum, issueStatusEnum, jobsiteAnalysisStatusEnum, lienWaiverStatusEnum, lienWaiverTypeEnum, locationLevelEnum, maintenanceTypeEnum, measurementReviewStatusEnum, measurementSourceEnum, measurementStatusEnum, measurementTypeEnum, takeoffVersionStatusEnum, messageEntityTypeEnum, mobilePlatformEnum, offlineEntityTypeEnum, offlineOperationTypeEnum, offlineSyncStatusEnum, organizationDocumentTypeEnum, organizationDocumentVisibilityEnum, overheadCostActionEnum, overheadCostCategoryEnum, overheadCostFrequencyEnum, portalChatPriorityEnum, portalChatThreadCategoryEnum, portalChatThreadStatusEnum, pricebookImportJobStatusEnum, pricebookStatusEnum, pricingApprovalStatusEnum, pricingSourceTypeEnum, projectEquipmentPlanStatusEnum, repairStatusEnum, retentionActionEnum, retentionEntityTypeEnum, rewardTypeEnum, rfiCategoryEnum, rfiPriorityEnum, rfiStatusEnum, scheduleDependencyTypeEnum, scheduleGeneratedByEnum, scheduleTaskStatusEnum, socialAccountStatusEnum, socialPlatformEnum, socialPostStatusEnum, sovPaymentMethodEnum, sovStatusEnum, storedMaterialStatusEnum, retentionReleaseTypeEnum, retentionReleaseStatusEnum, sowAuditActionEnum, ssoProviderEnum, submittalCategoryEnum, submittalItemStatusEnum, submittalPhaseEnum, submittalReviewRoleEnum, submittalReviewStatusEnum, submittalStatusEnum, submittalTypeEnum, syncStatusEnum, tradeTypeEnum, transmittalStatusEnum, userRoleEnum, vendorEnrollmentStatusEnum, voiceLogStatusEnum, websiteDeploymentActionEnum, websitePageTypeEnum, websiteProjectStatusEnum, websiteStatusEnum, takeoffIssueCategoryEnum, takeoffIssueStatusEnum, talentAvailabilityEnum, talentProfileVisibilityEnum, workflowEntityTypeEnum, riskCategoryEnum, riskStatusEnum, workflowTemplateStatusEnum, workflowInstanceStatusEnum, videoCallStatusEnum, workflowNotificationChannelEnum, dotAgencyKindEnum, dotPayItemTypeEnum, dbeCertificationTypeEnum, suretyBondTypeEnum, suretyBondStatusEnum, haulTicketStatusEnum, swpppInspectionTypeEnum, idrStatusEnum, buyAmericaStatusEnum } from "../enums";
import { bids, organizations, projects, users } from "../core";
import { changeOrders, estimateLineItems, estimates, planDocuments, projectInspections, tasks, tmTickets } from "../operations";



// ============ UPGRADE WAVE: Integration Hub + AI Governance + Approvals + Document Control + Health ============

export const integrationConnections = pgTable("integration_connections", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  provider: integrationProviderEnum("provider").notNull(),
  status: integrationConnectionStatusEnum("status").notNull().default("pending"),
  displayName: text("display_name"),
  metadata: json("metadata"),
  lastSyncAt: timestamp("last_sync_at"),
  lastSyncError: text("last_sync_error"),
  createdByUserId: varchar("created_by_user_id").references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  orgIdx: index("integration_connections_org_idx").on(table.organizationId),
  providerIdx: index("integration_connections_provider_idx").on(table.provider),
}));

export const insertIntegrationConnectionSchema = createInsertSchema(integrationConnections).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertIntegrationConnection = z.infer<typeof insertIntegrationConnectionSchema>;
export type IntegrationConnection = typeof integrationConnections.$inferSelect;

// Table 2: integration_events_outbox
export const integrationEventsOutbox = pgTable("integration_events_outbox", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  connectionId: varchar("connection_id").notNull().references(() => integrationConnections.id, { onDelete: "cascade" }),
  eventType: text("event_type").notNull(),
  payload: json("payload").notNull(),
  status: integrationEventStatusEnum("status").notNull().default("queued"),
  attempts: integer("attempts").notNull().default(0),
  lastAttemptAt: timestamp("last_attempt_at"),
  lastError: text("last_error"),
  idempotencyKey: varchar("idempotency_key"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  orgIdx: index("integration_events_org_idx").on(table.organizationId),
  statusIdx: index("integration_events_status_idx").on(table.status),
  idempotencyIdx: unique("integration_events_idempotency").on(table.idempotencyKey),
}));

export const insertIntegrationEventsOutboxSchema = createInsertSchema(integrationEventsOutbox).omit({ id: true, createdAt: true });
export type InsertIntegrationEventsOutbox = z.infer<typeof insertIntegrationEventsOutboxSchema>;
export type IntegrationEventsOutbox = typeof integrationEventsOutbox.$inferSelect;

// Table 3: integration_webhook_subscriptions
export const integrationWebhookSubscriptions = pgTable("integration_webhook_subscriptions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  connectionId: varchar("connection_id").notNull().references(() => integrationConnections.id, { onDelete: "cascade" }),
  eventType: text("event_type").notNull(),
  targetUrl: text("target_url").notNull(),
  secret: text("secret"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  orgIdx: index("integration_webhooks_org_idx").on(table.organizationId),
  connectionIdx: index("integration_webhooks_connection_idx").on(table.connectionId),
}));

export const insertIntegrationWebhookSubscriptionSchema = createInsertSchema(integrationWebhookSubscriptions).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertIntegrationWebhookSubscription = z.infer<typeof insertIntegrationWebhookSubscriptionSchema>;
export type IntegrationWebhookSubscription = typeof integrationWebhookSubscriptions.$inferSelect;

// Table 4: integration_sync_state
export const integrationSyncState = pgTable("integration_sync_state", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  connectionId: varchar("connection_id").notNull().references(() => integrationConnections.id, { onDelete: "cascade" }),
  entityType: text("entity_type").notNull(),
  cursor: text("cursor"),
  lastSyncAt: timestamp("last_sync_at"),
  // Task #1332: persisted "last sync attempt" tracking so failed background
  // syncs (e.g. Davis-Bacon auto-sync queued during project create/update)
  // surface to users instead of being buried in server logs. lastAttemptAt
  // is bumped on every attempt; lastError is set on failure and cleared on
  // success so a successful sync naturally clears any prior failure state.
  lastAttemptAt: timestamp("last_attempt_at"),
  lastError: text("last_error"),
  // Task #1354: scheduled-retry bookkeeping for failed background syncs
  // (initially: Davis-Bacon wage decisions). retryCount is the number of
  // failed attempts since the last success; nextRetryAt is when the
  // background retry job should re-attempt (null when the row is healthy
  // or has exhausted the max retry attempts and needs manual intervention).
  retryCount: integer("retry_count").notNull().default(0),
  nextRetryAt: timestamp("next_retry_at"),
  // Task #1391: timestamp recorded the first time a sync row hits
  // MAX_SYNC_RETRIES so we only fan out the "exhausted retries" admin
  // notification once per exhaustion event. Cleared by recordSyncSuccess
  // and clearSyncRetryState (manual retry) so a future re-exhaustion
  // re-fires the notification.
  exhaustedNotifiedAt: timestamp("exhausted_notified_at"),
  metadata: json("metadata"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  orgIdx: index("integration_sync_state_org_idx").on(table.organizationId),
  connectionEntityIdx: unique("integration_sync_connection_entity").on(table.connectionId, table.entityType),
}));

export const insertIntegrationSyncStateSchema = createInsertSchema(integrationSyncState).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertIntegrationSyncState = z.infer<typeof insertIntegrationSyncStateSchema>;
export type IntegrationSyncState = typeof integrationSyncState.$inferSelect;

// Task #1404 — per-connection (and optional per-entityType) mute state for
// the INTEGRATION_SYNC_RETRIES_EXHAUSTED admin fan-out. When a row exists
// for (connectionId, entityType=null) every exhaustion on that connection
// is silenced; when entityType is set the mute is scoped to that single
// entity. notifyAdminsOfExhaustedSyncRetry checks this table before
// fanning out; admins clear the row from the integrations page.
//
// Uniqueness is enforced by a partial expression index defined in the
// migration / ensure helper (COALESCE(entity_type, '')) because Postgres
// treats NULLs as distinct in a plain UNIQUE constraint.
export const integrationSyncAlertMutes = pgTable("integration_sync_alert_mutes", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  connectionId: varchar("connection_id").notNull().references(() => integrationConnections.id, { onDelete: "cascade" }),
  entityType: text("entity_type"),
  mutedByUserId: varchar("muted_by_user_id").references(() => users.id, { onDelete: "set null" }),
  reason: text("reason"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  orgIdx: index("integration_sync_alert_mutes_org_idx").on(table.organizationId),
  connectionIdx: index("integration_sync_alert_mutes_connection_idx").on(table.connectionId),
}));

export const insertIntegrationSyncAlertMuteSchema = createInsertSchema(integrationSyncAlertMutes).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertIntegrationSyncAlertMute = z.infer<typeof insertIntegrationSyncAlertMuteSchema>;
export type IntegrationSyncAlertMute = typeof integrationSyncAlertMutes.$inferSelect;

// Task #1409 — per-classification record of the most recent stale-refresh
// diff for a Davis-Bacon wage decision. processStaleWageDecisions writes
// one row per (organizationId, decisionNumber, classification) whose
// rate changed in the latest auto-refresh, replacing any earlier row
// for the same triple. The project prevailing wage panel reads these
// rows to badge classifications whose rate just shifted, so PMs can
// reconcile certified payrolls without cross-referencing the email
// notification fan-out from Task #1400. The flag clears either when a
// PM acknowledges it (acknowledgedAt is set) or when a subsequent
// refresh produces no diff for that classification (the row is deleted).
export const wageDecisionRateChanges = pgTable("wage_decision_rate_changes", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  decisionNumber: text("decision_number").notNull(),
  classification: text("classification").notNull(),
  changeKind: text("change_kind").notNull(),
  oldBaseRate: decimal("old_base_rate", { precision: 10, scale: 2 }),
  newBaseRate: decimal("new_base_rate", { precision: 10, scale: 2 }),
  oldFringeRate: decimal("old_fringe_rate", { precision: 10, scale: 2 }),
  newFringeRate: decimal("new_fringe_rate", { precision: 10, scale: 2 }),
  oldTotalRate: decimal("old_total_rate", { precision: 10, scale: 2 }),
  newTotalRate: decimal("new_total_rate", { precision: 10, scale: 2 }),
  detectedAt: timestamp("detected_at").notNull().defaultNow(),
  acknowledgedAt: timestamp("acknowledged_at"),
  acknowledgedByUserId: varchar("acknowledged_by_user_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  orgDecisionIdx: index("wage_decision_rate_changes_org_decision_idx").on(table.organizationId, table.decisionNumber),
  uniq: unique("wage_decision_rate_changes_org_decision_class_uniq").on(table.organizationId, table.decisionNumber, table.classification),
}));

export const insertWageDecisionRateChangeSchema = createInsertSchema(wageDecisionRateChanges).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertWageDecisionRateChange = z.infer<typeof insertWageDecisionRateChangeSchema>;
export type WageDecisionRateChange = typeof wageDecisionRateChanges.$inferSelect;

// Task #1480 — append-only audit history of every PM acknowledgement of a
// Davis-Bacon rate-change flag. The base `wage_decision_rate_changes` table
// holds at most one row per (organizationId, decisionNumber, classification)
// (a re-arm via a subsequent stale-refresh diff overwrites the prior
// `acknowledgedAt`/`acknowledgedByUserId`), so it cannot satisfy auditors who
// need a chronological record of every "PM X acknowledged Carpenter rate
// change on Y" — including superseded acknowledgements. This table captures
// each acknowledgement event together with the diff payload that was
// acknowledged, so the prevailing-wage panel's "View history" affordance can
// render a complete trail per classification even after auto-clear /
// re-arm has wiped the original `wage_decision_rate_changes` row.
export const wageDecisionRateChangeAcknowledgements = pgTable("wage_decision_rate_change_acknowledgements", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  decisionNumber: text("decision_number").notNull(),
  classification: text("classification").notNull(),
  changeKind: text("change_kind").notNull(),
  oldBaseRate: decimal("old_base_rate", { precision: 10, scale: 2 }),
  newBaseRate: decimal("new_base_rate", { precision: 10, scale: 2 }),
  oldFringeRate: decimal("old_fringe_rate", { precision: 10, scale: 2 }),
  newFringeRate: decimal("new_fringe_rate", { precision: 10, scale: 2 }),
  oldTotalRate: decimal("old_total_rate", { precision: 10, scale: 2 }),
  newTotalRate: decimal("new_total_rate", { precision: 10, scale: 2 }),
  detectedAt: timestamp("detected_at").notNull(),
  acknowledgedAt: timestamp("acknowledged_at").notNull().defaultNow(),
  acknowledgedByUserId: varchar("acknowledged_by_user_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  orgDecisionClassIdx: index("wage_decision_rate_change_ack_org_decision_class_idx").on(table.organizationId, table.decisionNumber, table.classification),
  acknowledgedAtIdx: index("wage_decision_rate_change_ack_acknowledged_at_idx").on(table.acknowledgedAt),
}));

export const insertWageDecisionRateChangeAcknowledgementSchema = createInsertSchema(wageDecisionRateChangeAcknowledgements).omit({ id: true, createdAt: true });
export type InsertWageDecisionRateChangeAcknowledgement = z.infer<typeof insertWageDecisionRateChangeAcknowledgementSchema>;
export type WageDecisionRateChangeAcknowledgement = typeof wageDecisionRateChangeAcknowledgements.$inferSelect;

export const qboAccountMappings = pgTable("qbo_account_mappings", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  connectionId: varchar("connection_id").notNull().references(() => integrationConnections.id, { onDelete: "cascade" }),
  costCode: text("cost_code").notNull(),
  qboAccountId: text("qbo_account_id").notNull(),
  qboAccountName: text("qbo_account_name").notNull(),
  mappingType: text("mapping_type").notNull().default("cost_code"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  orgIdx: index("qbo_account_mappings_org_idx").on(table.organizationId),
  connectionIdx: index("qbo_account_mappings_connection_idx").on(table.connectionId),
  uniqueMapping: unique("qbo_account_mappings_unique").on(table.organizationId, table.connectionId, table.costCode, table.mappingType),
}));

export const insertQboAccountMappingSchema = createInsertSchema(qboAccountMappings).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertQboAccountMapping = z.infer<typeof insertQboAccountMappingSchema>;
export type QboAccountMapping = typeof qboAccountMappings.$inferSelect;

export const qboSyncSchedules = pgTable("qbo_sync_schedules", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  connectionId: varchar("connection_id").notNull().references(() => integrationConnections.id, { onDelete: "cascade" }),
  operation: text("operation").notNull(),
  frequency: text("frequency").notNull().default("daily"),
  isActive: boolean("is_active").notNull().default(true),
  lastRunAt: timestamp("last_run_at"),
  nextRunAt: timestamp("next_run_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  orgIdx: index("qbo_sync_schedules_org_idx").on(table.organizationId),
  connectionIdx: index("qbo_sync_schedules_connection_idx").on(table.connectionId),
  activeIdx: index("qbo_sync_schedules_active_idx").on(table.isActive, table.nextRunAt),
}));

export const insertQboSyncScheduleSchema = createInsertSchema(qboSyncSchedules).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertQboSyncSchedule = z.infer<typeof insertQboSyncScheduleSchema>;
export type QboSyncSchedule = typeof qboSyncSchedules.$inferSelect;

// Task #1600 — Sage Intacct chart-of-accounts mapping (parallel to qbo_account_mappings).
// Records the per-(connection, costCode, mappingType) Sage GL account a SmartManageAI
// cost code should post against when journalising payroll, A/P, and other expenses
// via the Sage Intacct XML Gateway. Same shape as qbo_account_mappings so the
// admin Sage mapping panel can re-use the QBO panel's CRUD/auto-map workflow.
export const sageAccountMappings = pgTable("sage_account_mappings", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  connectionId: varchar("connection_id").notNull().references(() => integrationConnections.id, { onDelete: "cascade" }),
  costCode: text("cost_code").notNull(),
  sageAccountId: text("sage_account_id").notNull(),
  sageAccountName: text("sage_account_name").notNull(),
  mappingType: text("mapping_type").notNull().default("cost_code"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  orgIdx: index("sage_account_mappings_org_idx").on(table.organizationId),
  connectionIdx: index("sage_account_mappings_connection_idx").on(table.connectionId),
  uniqueMapping: unique("sage_account_mappings_unique").on(table.organizationId, table.connectionId, table.costCode, table.mappingType),
}));

export const insertSageAccountMappingSchema = createInsertSchema(sageAccountMappings).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertSageAccountMapping = z.infer<typeof insertSageAccountMappingSchema>;
export type SageAccountMapping = typeof sageAccountMappings.$inferSelect;

// Table 4b: zapier_webhooks – outgoing webhook configs for the Zapier provider
export const zapierWebhooks = pgTable("zapier_webhooks", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  connectionId: varchar("connection_id").notNull().references(() => integrationConnections.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  webhookUrl: text("webhook_url").notNull(),
  eventTypes: text("event_types").array().notNull(),
  isActive: boolean("is_active").notNull().default(true),
  secretKey: text("secret_key").notNull(),
  lastTriggeredAt: timestamp("last_triggered_at"),
  lastStatus: text("last_status"),
  triggerCount: integer("trigger_count").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  orgIdx: index("zapier_webhooks_org_idx").on(table.organizationId),
  connectionIdx: index("zapier_webhooks_connection_idx").on(table.connectionId),
}));

export const insertZapierWebhookSchema = createInsertSchema(zapierWebhooks).omit({ id: true, createdAt: true, updatedAt: true, triggerCount: true, lastTriggeredAt: true, lastStatus: true });
export type InsertZapierWebhook = z.infer<typeof insertZapierWebhookSchema>;
export type ZapierWebhook = typeof zapierWebhooks.$inferSelect;

export const ZAPIER_EVENT_TYPES = [
  "project.created",
  "project.updated",
  "project.status_changed",
  "bid.created",
  "bid.status_changed",
  "change_order.created",
  "change_order.approved",
  "change_order.rejected",
  "invoice.created",
  "invoice.paid",
  "time_entry.submitted",
  "time_entry.approved",
  "task.created",
  "task.completed",
  "document.uploaded",
  "safety_incident.reported",
] as const;

export type ZapierEventType = typeof ZAPIER_EVENT_TYPES[number];

// ============ Public API: API Keys + Request Log ============

export const PUBLIC_API_SCOPES = [
  "projects:read",
  "projects:write",
  "bids:read",
  "bids:write",
  "change_orders:read",
  "change_orders:write",
  "rfis:read",
  "rfis:write",
  "submittals:read",
  "submittals:write",
  "documents:read",
  "documents:write",
  "webhooks:manage",
] as const;
export type PublicApiScope = typeof PUBLIC_API_SCOPES[number];

export const PUBLIC_API_EVENT_TYPES = [
  "project.created",
  "project.updated",
  "bid.created",
  "bid.status_changed",
  "change_order.created",
  "change_order.approved",
  "change_order.rejected",
  "rfi.created",
  "rfi.answered",
  "submittal.created",
  "submittal.approved",
  "document.uploaded",
] as const;
export type PublicApiEventType = typeof PUBLIC_API_EVENT_TYPES[number];

export const integrationApiKeys = pgTable("integration_api_keys", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  prefix: varchar("prefix", { length: 16 }).notNull(),
  keyHash: text("key_hash").notNull(),
  scopes: text("scopes").array().notNull().default(sql`ARRAY[]::text[]`),
  rateLimitPerMinute: integer("rate_limit_per_minute").notNull().default(120),
  isActive: boolean("is_active").notNull().default(true),
  lastUsedAt: timestamp("last_used_at"),
  expiresAt: timestamp("expires_at"),
  createdByUserId: varchar("created_by_user_id").references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  revokedAt: timestamp("revoked_at"),
}, (table) => ({
  orgIdx: index("integration_api_keys_org_idx").on(table.organizationId),
  prefixIdx: index("integration_api_keys_prefix_idx").on(table.prefix),
}));

export const insertIntegrationApiKeySchema = createInsertSchema(integrationApiKeys).omit({ id: true, createdAt: true, lastUsedAt: true, revokedAt: true, keyHash: true, prefix: true });
export type InsertIntegrationApiKey = z.infer<typeof insertIntegrationApiKeySchema>;
export type IntegrationApiKey = typeof integrationApiKeys.$inferSelect;

export const integrationApiRequestLog = pgTable("integration_api_request_log", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  apiKeyId: varchar("api_key_id").references(() => integrationApiKeys.id, { onDelete: "set null" }),
  method: varchar("method", { length: 10 }).notNull(),
  path: text("path").notNull(),
  statusCode: integer("status_code").notNull(),
  durationMs: integer("duration_ms"),
  scopeUsed: text("scope_used"),
  errorMessage: text("error_message"),
  ip: text("ip"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  orgIdx: index("integration_api_log_org_idx").on(table.organizationId),
  keyIdx: index("integration_api_log_key_idx").on(table.apiKeyId),
  createdIdx: index("integration_api_log_created_idx").on(table.createdAt),
}));

export type IntegrationApiRequestLog = typeof integrationApiRequestLog.$inferSelect;