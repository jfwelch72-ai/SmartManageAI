// AUTO-GENERATED SPLIT FROM shared/schema/features.ts (Task #2426).
// Domain bucketing rule lives in shared/schema/features/index.ts.
import { sql } from "drizzle-orm";
import { pgTable, text, varchar, boolean, timestamp, date, decimal, integer, pgEnum, doublePrecision, index, unique, uniqueIndex, json, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod";
import { addendumRecipientTypeEnum, addendumStatusEnum, aiBidDocumentAnalysisStatusEnum, aiCoDraftStatusEnum, aiContractDocumentAnalysisStatusEnum, contractStatusEnum, contractTypeEnum, contractRedlineStatusEnum, contractApprovalDecisionEnum, clauseCategoryEnum, signatureRequestStatusEnum, signerStatusEnum, aiInsightModuleEnum, aiInsightSeverityEnum, aiTakeoffModeEnum, aiTakeoffStatusEnum, aiTakeoffSuggestionStatusEnum, aiTakeoffRejectReasonEnum, aiTaskPriorityEnum, aiTaskStatusEnum, approvalEntityTypeEnum, approvalStatusEnum, atsProviderEnum, bidEquipmentSourceEnum, bidInvitationStatusEnum, bidRequestStatusEnum, bidResponseStatusEnum, blogCommentStatusEnum, blogPostStatusEnum, conversationTypeEnum, crewAvailabilityStatusEnum, crmActivityTypeEnum, crmCallDirectionEnum, crmCallOutcomeEnum, crmCallStatusEnum, crmCustomFieldEntityEnum, crmCustomFieldTypeEnum, crmContactRoleEnum, crmNoteTypeEnum, crmOrgStatusEnum, crmOrganisationTypeEnum, crmPipelineStageEnum, crmPreferredContactEnum, crmLostCategoryEnum, crmQuoteAcceptanceStatusEnum, crmLeadScoringOperatorEnum, crmSequenceStatusEnum, crmSequenceStepTypeEnum, crmSequenceEnrollmentStatusEnum, crmSequenceExecutionStatusEnum, crmSequenceEmailEventTypeEnum, crmSequenceExitReasonEnum, crmQuoteApprovalStatusEnum, dataSubjectRequestStatusEnum, dataSubjectRequestTypeEnum, documentRevisionSourceEnum, documentRevisionStatusEnum, emailClassificationEnum, emailProviderEnum, emailTaskSourceEnum, emailThreadStatusEnum, hiringActivityTypeEnum, hiringCandidateStageEnum, hiringCompensationTypeEnum, hiringEmploymentTypeEnum, hiringInterviewStatusEnum, hiringJobStatusEnum, hiringSyncStatusEnum, hustlerDelegateRoleEnum, hustlerLinkRequestStatusEnum, installationStatusEnum, lidarScanStatusEnum, lidarAnnotationTypeEnum, lidarComparisonTypeEnum, unifiedPaymentMethodEnum, unifiedPaymentStatusEnum, invoiceTypeEnum, integrationConnectionStatusEnum, integrationEventStatusEnum, integrationProviderEnum, issueSeverityEnum, issueStatusEnum, jobsiteAnalysisStatusEnum, lienWaiverStatusEnum, lienWaiverTypeEnum, locationLevelEnum, maintenanceTypeEnum, measurementReviewStatusEnum, measurementSourceEnum, measurementStatusEnum, measurementTypeEnum, takeoffVersionStatusEnum, messageEntityTypeEnum, mobilePlatformEnum, offlineEntityTypeEnum, offlineOperationTypeEnum, offlineSyncStatusEnum, organizationDocumentTypeEnum, organizationDocumentVisibilityEnum, overheadCostActionEnum, overheadCostCategoryEnum, overheadCostFrequencyEnum, portalChatPriorityEnum, portalChatThreadCategoryEnum, portalChatThreadStatusEnum, pricebookImportJobStatusEnum, pricebookStatusEnum, pricingApprovalStatusEnum, pricingSourceTypeEnum, projectEquipmentPlanStatusEnum, repairStatusEnum, retentionActionEnum, retentionEntityTypeEnum, rewardTypeEnum, rfiCategoryEnum, rfiPriorityEnum, rfiStatusEnum, scheduleDependencyTypeEnum, scheduleGeneratedByEnum, scheduleTaskStatusEnum, socialAccountStatusEnum, socialPlatformEnum, socialPostStatusEnum, sovPaymentMethodEnum, sovStatusEnum, storedMaterialStatusEnum, retentionReleaseTypeEnum, retentionReleaseStatusEnum, sowAuditActionEnum, ssoProviderEnum, submittalCategoryEnum, submittalItemStatusEnum, submittalPhaseEnum, submittalReviewRoleEnum, submittalReviewStatusEnum, submittalStatusEnum, submittalTypeEnum, syncStatusEnum, tradeTypeEnum, transmittalStatusEnum, userRoleEnum, vendorEnrollmentStatusEnum, voiceLogStatusEnum, websiteDeploymentActionEnum, websitePageTypeEnum, websiteProjectStatusEnum, websiteStatusEnum, takeoffIssueCategoryEnum, takeoffIssueStatusEnum, talentAvailabilityEnum, talentProfileVisibilityEnum, workflowEntityTypeEnum, riskCategoryEnum, riskStatusEnum, workflowTemplateStatusEnum, workflowInstanceStatusEnum, videoCallStatusEnum, workflowNotificationChannelEnum, dotAgencyKindEnum, dotPayItemTypeEnum, dbeCertificationTypeEnum, suretyBondTypeEnum, suretyBondStatusEnum, haulTicketStatusEnum, swpppInspectionTypeEnum, idrStatusEnum, buyAmericaStatusEnum } from "../enums";
import { bids, organizations, projects, users } from "../core";
import { changeOrders, estimateLineItems, estimates, planDocuments, projectInspections, tasks, tmTickets } from "../operations";
import { takeoffSheets } from "./takeoff";



// =====================================================================
// Task #2324 — AI Estimator workspace
// Per-user enablement, learning pipeline, feedback events, retrieval
// index, web research cache, and chat session storage.
// =====================================================================

// Per-user enablement of the AI Estimator. An org admin must explicitly
// flip a user on (or off). This is independent of the canUseAiEstimator
// feature permission so orgs can keep the surface dark for users that
// have it on by role default but haven't been onboarded yet.
export const aiEstimatorUserAccess = pgTable("ai_estimator_user_access", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  enabled: boolean("enabled").notNull().default(false),
  canTrain: boolean("can_train").notNull().default(false),
  enabledByUserId: varchar("enabled_by_user_id").references(() => users.id, { onDelete: "set null" }),
  enabledAt: timestamp("enabled_at"),
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  orgIdx: index("ai_estimator_user_access_org_idx").on(table.organizationId),
  userIdx: index("ai_estimator_user_access_user_idx").on(table.userId),
  orgUserUnique: unique("ai_estimator_user_access_org_user_unique").on(table.organizationId, table.userId),
}));
export const insertAiEstimatorUserAccessSchema = createInsertSchema(aiEstimatorUserAccess).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertAiEstimatorUserAccess = z.infer<typeof insertAiEstimatorUserAccessSchema>;
export type AiEstimatorUserAccess = typeof aiEstimatorUserAccess.$inferSelect;

// Every AI suggestion (takeoff item, draft estimate line, inline cost
// suggestion, chat answer) writes a feedback event when the user
// accepts / edits / rejects it. Captured original vs final values feed
// the learned-rates store.
export const aiEstimatorFeedbackEvents = pgTable("ai_estimator_feedback_events", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  userId: varchar("user_id").references(() => users.id, { onDelete: "set null" }),
  // What surface generated the suggestion
  surface: text("surface").notNull(), // 'takeoff_draft' | 'estimate_draft' | 'inline_unit_cost' | 'inline_labor_hours' | 'inline_production_rate' | 'chat_answer' | 'web_research'
  // What entity the suggestion is about
  targetType: text("target_type").notNull(), // 'takeoff_measurement' | 'estimate_line_item' | 'cost_code_rate' | 'chat_message'
  targetId: varchar("target_id"),
  bidId: varchar("bid_id").references(() => bids.id, { onDelete: "set null" }),
  estimateId: varchar("estimate_id").references(() => estimates.id, { onDelete: "set null" }),
  projectId: varchar("project_id").references(() => projects.id, { onDelete: "set null" }),
  takeoffSheetId: varchar("takeoff_sheet_id").references(() => takeoffSheets.id, { onDelete: "set null" }),
  costCode: text("cost_code"),
  tradeType: text("trade_type"),
  outcome: text("outcome").notNull(), // 'ACCEPTED' | 'EDITED' | 'REJECTED' | 'THUMBS_UP' | 'THUMBS_DOWN'
  // Captured payloads — original AI suggestion and final user-confirmed value.
  // Stored as jsonb so we can capture per-field deltas for measurements
  // (added/deleted/moved/resized/recounted) and for line items
  // (qty/unit-cost/labor-hours/production-rate/scope-item).
  originalValue: jsonb("original_value"),
  finalValue: jsonb("final_value"),
  comment: text("comment"),
  // Source link back to the AI audit row that produced the suggestion.
  aiAuditId: varchar("ai_audit_id"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  orgIdx: index("ai_estimator_feedback_org_idx").on(table.organizationId),
  surfaceIdx: index("ai_estimator_feedback_surface_idx").on(table.surface),
  costCodeIdx: index("ai_estimator_feedback_cost_code_idx").on(table.costCode),
  createdAtIdx: index("ai_estimator_feedback_created_at_idx").on(table.createdAt),
  bidIdx: index("ai_estimator_feedback_bid_idx").on(table.bidId),
  estimateIdx: index("ai_estimator_feedback_estimate_idx").on(table.estimateId),
}));
export const insertAiEstimatorFeedbackEventSchema = createInsertSchema(aiEstimatorFeedbackEvents).omit({ id: true, createdAt: true });
export type InsertAiEstimatorFeedbackEvent = z.infer<typeof insertAiEstimatorFeedbackEventSchema>;
export type AiEstimatorFeedbackEvent = typeof aiEstimatorFeedbackEvents.$inferSelect;

// Per-org rolling unit-cost / production-rate statistics by cost code
// (and optionally trade + region + project type). Updated by the
// ingestion job and immediately by feedback events. Feeds inline
// suggestions, draft-estimate generation, and chat answers.
export const aiEstimatorLearnedRates = pgTable("ai_estimator_learned_rates", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  costCode: text("cost_code").notNull(),
  metric: text("metric").notNull(), // 'unit_cost' | 'labor_hours_per_unit' | 'production_rate'
  unit: text("unit").notNull(), // 'EA','LF','SF','SY','CY','TON','HR','LS','PCT'
  tradeType: text("trade_type"),
  region: text("region"),
  projectType: text("project_type"),
  sampleSize: integer("sample_size").notNull().default(0),
  meanValue: decimal("mean_value", { precision: 14, scale: 4 }),
  medianValue: decimal("median_value", { precision: 14, scale: 4 }),
  p25Value: decimal("p25_value", { precision: 14, scale: 4 }),
  p75Value: decimal("p75_value", { precision: 14, scale: 4 }),
  minValue: decimal("min_value", { precision: 14, scale: 4 }),
  maxValue: decimal("max_value", { precision: 14, scale: 4 }),
  // Raw sample values stored so we can recompute percentiles cheaply
  // when a new feedback event arrives without scanning every line item.
  // Capped at 200 most-recent samples per (org, costCode, metric).
  recentSamples: jsonb("recent_samples").default(sql`'[]'::jsonb`),
  lastUpdatedAt: timestamp("last_updated_at").notNull().defaultNow(),
  lastSourceType: text("last_source_type"), // 'historical_actual' | 'estimate_line_item' | 'feedback_event'
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  orgIdx: index("ai_estimator_learned_rates_org_idx").on(table.organizationId),
  orgCcIdx: index("ai_estimator_learned_rates_org_cc_idx").on(table.organizationId, table.costCode),
  uniqByDimensions: uniqueIndex("ai_estimator_learned_rates_uniq").on(
    table.organizationId,
    table.costCode,
    table.metric,
    table.unit,
  ),
}));
export const insertAiEstimatorLearnedRateSchema = createInsertSchema(aiEstimatorLearnedRates).omit({ id: true, createdAt: true, lastUpdatedAt: true });
export type InsertAiEstimatorLearnedRate = z.infer<typeof insertAiEstimatorLearnedRateSchema>;
export type AiEstimatorLearnedRate = typeof aiEstimatorLearnedRates.$inferSelect;

// Knowledge index for retrieval. One row per indexed source: a historical
// bid, awarded project, completed takeoff, cost ledger posting, etc.
// Stored with a content snippet and metadata so the chat assistant and
// draft-estimate generator can pull the most relevant prior records.
// Vector embeddings are deferred — first-pass retrieval is keyword + tag
// based using the existing Postgres full-text search, which keeps the
// data model self-contained.
export const aiEstimatorKnowledgeIndex = pgTable("ai_estimator_knowledge_index", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  sourceType: text("source_type").notNull(), // 'bid' | 'estimate' | 'estimate_line_item' | 'takeoff_measurement' | 'cost_ledger_posting' | 'historical_cost' | 'qualitative_lesson'
  sourceId: varchar("source_id").notNull(),
  bidId: varchar("bid_id").references(() => bids.id, { onDelete: "set null" }),
  projectId: varchar("project_id").references(() => projects.id, { onDelete: "set null" }),
  costCode: text("cost_code"),
  tradeType: text("trade_type"),
  title: text("title").notNull(),
  contentSnippet: text("content_snippet").notNull(),
  // Searchable tag bag for filtering (location, project type, etc).
  tags: text("tags").array(),
  // Numeric facets used by the chat tool for quick aggregation
  // (e.g. unit cost, qty, total cost).
  numericFacets: jsonb("numeric_facets"),
  indexedAt: timestamp("indexed_at").notNull().defaultNow(),
  contentHash: text("content_hash"),
  // Task #2414 — Claude-written narrative summary for the row, written by
  // the post-ingestion enrichment pass (see server/services/aiEstimator/enrichment.ts).
  // Nullable: rows whose org doesn't have AI_PROVIDER_TAKEOFF, or whose
  // enrichment call errored, fall back to `contentSnippet`.
  enrichedSummary: text("enriched_summary"),
  enrichedAt: timestamp("enriched_at"),
  // Task #2415 — qualitative-lesson rows ride on the same knowledge index
  // so retrieval can pull them alongside historical bids/estimates without
  // a separate table. These fields are nullable for every other source
  // type and only populated when sourceType = 'qualitative_lesson'.
  // lessonScope: which dimension the lesson applies to. Drives retrieval
  // matching alongside costCode/tradeType/surface.
  lessonScope: text("lesson_scope"), // 'global' | 'cost_code' | 'trade' | 'surface'
  // lessonStatus: lifecycle. 'active' rows are injected into prompts; 'stale'
  // rows are kept for audit but not retrieved; 'deleted' rows are soft-deleted
  // by an admin and never retrieved.
  lessonStatus: text("lesson_status"), // 'active' | 'stale' | 'deleted'
  // surface (e.g. 'chat_answer', 'inline_unit_cost') the lesson was learned
  // from, so retrieval can prefer lessons relevant to the current call site.
  lessonSurface: text("lesson_surface"),
  // When this lesson supersedes an older one in the same bucket, points at
  // that older row's id; the older row gets lessonStatus='stale'.
  supersedesRowId: varchar("supersedes_row_id"),
  // List of feedback-event ids this lesson was synthesized from. Used to
  // dedupe (no second lesson for the same event) and to display provenance
  // in the admin panel.
  derivedFromFeedbackIds: jsonb("derived_from_feedback_ids"),
}, (table) => ({
  orgIdx: index("ai_estimator_knowledge_org_idx").on(table.organizationId),
  sourceIdx: index("ai_estimator_knowledge_source_idx").on(table.sourceType, table.sourceId),
  costCodeIdx: index("ai_estimator_knowledge_cost_code_idx").on(table.costCode),
  uniqSource: uniqueIndex("ai_estimator_knowledge_uniq_source").on(
    table.organizationId,
    table.sourceType,
    table.sourceId,
  ),
  // Task #2415 — fast lookup of active lessons by bucket for retrieval and
  // for dedup checks before insert.
  lessonStatusIdx: index("ai_estimator_knowledge_lesson_status_idx").on(table.lessonStatus),
}));
export const insertAiEstimatorKnowledgeIndexSchema = createInsertSchema(aiEstimatorKnowledgeIndex).omit({ id: true, indexedAt: true });
export type InsertAiEstimatorKnowledgeIndex = z.infer<typeof insertAiEstimatorKnowledgeIndexSchema>;
export type AiEstimatorKnowledgeIndex = typeof aiEstimatorKnowledgeIndex.$inferSelect;

// Web research cache. The controlled, allow-listed fetcher caches
// responses here so subsequent AI calls re-use the same content and
// every output that quotes a web page can render the original source URL.
export const aiEstimatorWebResearchCache = pgTable("ai_estimator_web_research_cache", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  url: text("url").notNull(),
  domain: text("domain").notNull(),
  query: text("query"),
  title: text("title"),
  contentSnippet: text("content_snippet").notNull(),
  contentHash: text("content_hash").notNull(),
  fetchedAt: timestamp("fetched_at").notNull().defaultNow(),
  expiresAt: timestamp("expires_at"),
  fetchedByUserId: varchar("fetched_by_user_id").references(() => users.id, { onDelete: "set null" }),
}, (table) => ({
  orgIdx: index("ai_estimator_web_cache_org_idx").on(table.organizationId),
  domainIdx: index("ai_estimator_web_cache_domain_idx").on(table.domain),
  uniqUrl: uniqueIndex("ai_estimator_web_cache_uniq_url").on(table.organizationId, table.url),
}));
export const insertAiEstimatorWebResearchCacheSchema = createInsertSchema(aiEstimatorWebResearchCache).omit({ id: true, fetchedAt: true });
export type InsertAiEstimatorWebResearchCache = z.infer<typeof insertAiEstimatorWebResearchCacheSchema>;
export type AiEstimatorWebResearchCache = typeof aiEstimatorWebResearchCache.$inferSelect;

// Chat sessions for the "Ask the Estimator" panel. Each session is
// tied to a user and optionally pinned to a bid/estimate/project so
// retrieval can default-scope to that workspace.
export const aiEstimatorChatSessions = pgTable("ai_estimator_chat_sessions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  bidId: varchar("bid_id").references(() => bids.id, { onDelete: "set null" }),
  estimateId: varchar("estimate_id").references(() => estimates.id, { onDelete: "set null" }),
  projectId: varchar("project_id").references(() => projects.id, { onDelete: "set null" }),
  title: text("title"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  orgIdx: index("ai_estimator_chat_sessions_org_idx").on(table.organizationId),
  userIdx: index("ai_estimator_chat_sessions_user_idx").on(table.userId),
  bidIdx: index("ai_estimator_chat_sessions_bid_idx").on(table.bidId),
}));
export const insertAiEstimatorChatSessionSchema = createInsertSchema(aiEstimatorChatSessions).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertAiEstimatorChatSession = z.infer<typeof insertAiEstimatorChatSessionSchema>;
export type AiEstimatorChatSession = typeof aiEstimatorChatSessions.$inferSelect;

export const aiEstimatorChatMessages = pgTable("ai_estimator_chat_messages", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  sessionId: varchar("session_id").notNull().references(() => aiEstimatorChatSessions.id, { onDelete: "cascade" }),
  role: text("role").notNull(), // 'user' | 'assistant' | 'system'
  content: text("content").notNull(),
  // Citations: array of { type: 'org' | 'web', sourceType?, sourceId?, title?, url? }
  citations: jsonb("citations"),
  feedbackOutcome: text("feedback_outcome"), // null | 'THUMBS_UP' | 'THUMBS_DOWN'
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  sessionIdx: index("ai_estimator_chat_messages_session_idx").on(table.sessionId),
  createdAtIdx: index("ai_estimator_chat_messages_created_at_idx").on(table.createdAt),
}));
export const insertAiEstimatorChatMessageSchema = createInsertSchema(aiEstimatorChatMessages).omit({ id: true, createdAt: true });
export type InsertAiEstimatorChatMessage = z.infer<typeof insertAiEstimatorChatMessageSchema>;
export type AiEstimatorChatMessage = typeof aiEstimatorChatMessages.$inferSelect;

// Tracks ingestion job runs so the admin page can show "last refresh /
// records ingested / errors" and so the manual re-ingest button is idempotent.
export const aiEstimatorIngestRuns = pgTable("ai_estimator_ingest_runs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  triggeredByUserId: varchar("triggered_by_user_id").references(() => users.id, { onDelete: "set null" }),
  triggerType: text("trigger_type").notNull().default("MANUAL"), // 'MANUAL' | 'SCHEDULED' | 'EVENT'
  status: text("status").notNull().default("RUNNING"), // 'RUNNING' | 'SUCCEEDED' | 'FAILED'
  bidsIngested: integer("bids_ingested").notNull().default(0),
  estimatesIngested: integer("estimates_ingested").notNull().default(0),
  lineItemsIngested: integer("line_items_ingested").notNull().default(0),
  takeoffsIngested: integer("takeoffs_ingested").notNull().default(0),
  costPostingsIngested: integer("cost_postings_ingested").notNull().default(0),
  ratesUpdated: integer("rates_updated").notNull().default(0),
  // Task #2414 — knowledge-index rows for which the post-ingestion
  // enrichment pass produced a Claude-written narrative summary.
  rowsEnriched: integer("rows_enriched").notNull().default(0),
  errorMessage: text("error_message"),
  startedAt: timestamp("started_at").notNull().defaultNow(),
  completedAt: timestamp("completed_at"),
}, (table) => ({
  orgIdx: index("ai_estimator_ingest_runs_org_idx").on(table.organizationId),
  startedAtIdx: index("ai_estimator_ingest_runs_started_at_idx").on(table.startedAt),
}));
export const insertAiEstimatorIngestRunSchema = createInsertSchema(aiEstimatorIngestRuns).omit({ id: true, startedAt: true });
export type InsertAiEstimatorIngestRun = z.infer<typeof insertAiEstimatorIngestRunSchema>;
export type AiEstimatorIngestRun = typeof aiEstimatorIngestRuns.$inferSelect;

// Per-sample provenance table. One row per contributing sample so
// senior estimators can drill down to see which project / bid / line
// item each learned-rate value came from.
export const aiEstimatorRateSamples = pgTable("ai_estimator_rate_samples", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  learnedRateId: varchar("learned_rate_id").references(() => aiEstimatorLearnedRates.id, { onDelete: "cascade" }),
  costCode: text("cost_code").notNull(),
  metric: text("metric").notNull(), // 'unit_cost' | 'labor_hours_per_unit' | 'production_rate'
  unit: text("unit").notNull(),
  value: decimal("value", { precision: 14, scale: 4 }).notNull(),
  sourceType: text("source_type").notNull(), // 'historical_actual' | 'estimate_line_item' | 'feedback_event' | 'legacy'
  sourceRowId: varchar("source_row_id"), // estimate line item id, historical cost id, feedback event id, etc.
  projectId: varchar("project_id").references(() => projects.id, { onDelete: "set null" }),
  bidId: varchar("bid_id").references(() => bids.id, { onDelete: "set null" }),
  recordedAt: timestamp("recorded_at").notNull().defaultNow(),
}, (table) => ({
  orgIdx: index("ai_estimator_rate_samples_org_idx").on(table.organizationId),
  rateIdx: index("ai_estimator_rate_samples_rate_idx").on(table.learnedRateId),
  projectIdx: index("ai_estimator_rate_samples_project_idx").on(table.projectId),
  costCodeIdx: index("ai_estimator_rate_samples_cost_code_idx").on(table.organizationId, table.costCode, table.metric, table.unit),
}));
export const insertAiEstimatorRateSampleSchema = createInsertSchema(aiEstimatorRateSamples).omit({ id: true, recordedAt: true });
export type InsertAiEstimatorRateSample = z.infer<typeof insertAiEstimatorRateSampleSchema>;
export type AiEstimatorRateSample = typeof aiEstimatorRateSamples.$inferSelect;

// Projects (and optionally bids) excluded from the learning pool.
// When a project is excluded its samples are removed from recompute and
// any new samples from that project are silently skipped.
export const aiEstimatorExcludedSources = pgTable("ai_estimator_excluded_sources", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  projectId: varchar("project_id").references(() => projects.id, { onDelete: "cascade" }),
  bidId: varchar("bid_id").references(() => bids.id, { onDelete: "cascade" }),
  reason: text("reason"),
  excludedById: varchar("excluded_by_id").references(() => users.id, { onDelete: "set null" }),
  excludedAt: timestamp("excluded_at").notNull().defaultNow(),
}, (table) => ({
  orgIdx: index("ai_estimator_excluded_sources_org_idx").on(table.organizationId),
  projectIdx: index("ai_estimator_excluded_sources_project_idx").on(table.projectId),
  uniq: uniqueIndex("ai_estimator_excluded_sources_uniq").on(table.organizationId, table.projectId),
}));
export const insertAiEstimatorExcludedSourceSchema = createInsertSchema(aiEstimatorExcludedSources).omit({ id: true, excludedAt: true });
export type InsertAiEstimatorExcludedSource = z.infer<typeof insertAiEstimatorExcludedSourceSchema>;
export type AiEstimatorExcludedSource = typeof aiEstimatorExcludedSources.$inferSelect;