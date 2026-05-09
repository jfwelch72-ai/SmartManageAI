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
  // Attachments uploaded with this user turn. Array of:
  //   { kind: 'image'|'document'|'audio', objectPath, contentType, fileName,
  //     sizeBytes, transcript?, extractedText? }
  // null on assistant/system rows and on legacy user rows.
  attachments: jsonb("attachments"),
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
// =====================================================================
// Task #2466 — AI Estimator real-world upgrade.
// Phase 1 + Phase 2 schema groundwork:
//   - sheet-index discipline routing (columns added directly to
//     `takeoff_sheets` in shared/schema/features/takeoff.ts)
//   - legend-symbol parsing scaffold
//   - assemblies catalog (org-level, with components)
//   - org-level estimating factors (waste %, productivity, city cost
//     index, prevailing wage)
// =====================================================================

// Per-project parsed legend symbols. Populated by the legend-parsing
// pass; counts are aggregated across the relevant sheets and persisted
// here so the estimate generator can quote symbol-driven counts (doors,
// fixtures, devices) with a clickable source.
export const aiEstimatorLegendSymbols = pgTable("ai_estimator_legend_symbols", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  projectId: varchar("project_id").references(() => projects.id, { onDelete: "cascade" }),
  bidId: varchar("bid_id").references(() => bids.id, { onDelete: "cascade" }),
  // The sheet the legend was parsed FROM (a legend page) and an
  // optional bbox of the glyph in image coordinates so the UI can
  // crop & display it.
  legendSheetId: varchar("legend_sheet_id").references(() => takeoffSheets.id, { onDelete: "set null" }),
  glyphBbox: jsonb("glyph_bbox"), // { x, y, w, h }
  // The glyph's symbol code (e.g. "D-1", "FX-A") and the legend's
  // human-readable definition ("Door type 1, 3'-0"x7'-0" HM").
  symbolCode: text("symbol_code").notNull(),
  definition: text("definition").notNull(),
  trade: text("trade"), // 'A' | 'M' | 'E' | 'P' | 'S' | 'C' | etc.
  // Aggregated count across the project's sheets (or a single-sheet
  // count when the legend is per-sheet).
  count: integer("count").notNull().default(0),
  // JSON list of { sheetId, regionBbox } occurrences for click-through.
  occurrences: jsonb("occurrences"),
  source: text("source").notNull().default("AI_DETECTED"), // 'AI_DETECTED' | 'USER' | 'AI_SCHEDULE'
  confidence: text("confidence").notNull().default("MEDIUM"), // HIGH | MEDIUM | LOW
  // Task #2577 Phase B Step 4 — Schedule review lifecycle.
  // PENDING_REVIEW (default for AI rows), ACCEPTED (after accept),
  // REJECTED (estimator dismissed), EDITED (estimator tweaked count or
  // code before / instead of accepting).
  reviewStatus: text("review_status").notNull().default("PENDING_REVIEW"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  orgIdx: index("ai_estimator_legend_symbols_org_idx").on(table.organizationId),
  projectIdx: index("ai_estimator_legend_symbols_project_idx").on(table.projectId),
  bidIdx: index("ai_estimator_legend_symbols_bid_idx").on(table.bidId),
  reviewStatusIdx: index("ai_estimator_legend_symbols_review_status_idx").on(table.reviewStatus),
  uniq: uniqueIndex("ai_estimator_legend_symbols_uniq").on(
    table.organizationId,
    table.bidId,
    table.symbolCode,
  ),
}));
export const insertAiEstimatorLegendSymbolSchema = createInsertSchema(aiEstimatorLegendSymbols).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertAiEstimatorLegendSymbol = z.infer<typeof insertAiEstimatorLegendSymbolSchema>;
export type AiEstimatorLegendSymbol = typeof aiEstimatorLegendSymbols.$inferSelect;

// Org-level Assemblies catalog. An assembly maps a takeoff measurement
// type (e.g. "8\" CMU wall", an AREA in SF) to a bundle of materials,
// labor and equipment. The draft estimate generator looks up an
// assembly by (org, label/cost code, measurement type) and emits one
// component line per child instead of a single raw line item.
export const aiEstimatorAssemblies = pgTable("ai_estimator_assemblies", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  // Null `organizationId` would represent a platform default; for now
  // every assembly is org-scoped — defaults are seeded per org on
  // first use. (Platform-wide defaults are a follow-up.)
  name: text("name").notNull(),
  description: text("description"),
  costCode: text("cost_code"),
  tradeType: text("trade_type"),
  // The takeoff measurement type this assembly is driven by.
  // 'AREA' | 'LINEAR' | 'COUNT' | 'VOLUME'
  drivingMeasurementType: text("driving_measurement_type").notNull(),
  // The unit of the driving quantity ('SF','LF','EA','CY' ...).
  drivingUnit: text("driving_unit").notNull(),
  // Org-level waste % to apply to the driving qty. 0..1.
  wasteFactor: doublePrecision("waste_factor").notNull().default(0),
  // Productivity of the controlling crew, expressed in driving units
  // per crew-hour. Used to derive activity duration on schedule push.
  productionRatePerHour: doublePrecision("production_rate_per_hour"),
  isActive: boolean("is_active").notNull().default(true),
  createdById: varchar("created_by_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  orgIdx: index("ai_estimator_assemblies_org_idx").on(table.organizationId),
  costCodeIdx: index("ai_estimator_assemblies_cost_code_idx").on(table.organizationId, table.costCode),
  uniqName: uniqueIndex("ai_estimator_assemblies_uniq_name").on(table.organizationId, table.name),
}));
export const insertAiEstimatorAssemblySchema = createInsertSchema(aiEstimatorAssemblies).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertAiEstimatorAssembly = z.infer<typeof insertAiEstimatorAssemblySchema>;
export type AiEstimatorAssembly = typeof aiEstimatorAssemblies.$inferSelect;

export const aiEstimatorAssemblyComponents = pgTable("ai_estimator_assembly_components", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  assemblyId: varchar("assembly_id").notNull().references(() => aiEstimatorAssemblies.id, { onDelete: "cascade" }),
  // 'MATERIAL' | 'LABOR' | 'EQUIPMENT' | 'SUB'
  componentType: text("component_type").notNull(),
  description: text("description").notNull(),
  costCode: text("cost_code"),
  // Quantity per ONE driving unit (e.g. 1.05 block per SF of wall when
  // already including waste). The draft generator multiplies this by
  // the takeoff's measured quantity * (1 + wasteFactor).
  qtyPerDrivingUnit: doublePrecision("qty_per_driving_unit").notNull().default(1),
  unit: text("unit").notNull(), // 'EA','LF','SF','CY','HR','LB' ...
  // Optional default unit cost; resolver still prefers vendor quote ->
  // learned rate -> published index -> this value -> AI fallback.
  defaultUnitCost: decimal("default_unit_cost", { precision: 14, scale: 4 }),
  // Component-level waste %. Stacks multiplicatively with assembly waste.
  wasteFactor: doublePrecision("waste_factor").notNull().default(0),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  assemblyIdx: index("ai_estimator_assembly_components_assembly_idx").on(table.assemblyId),
}));
export const insertAiEstimatorAssemblyComponentSchema = createInsertSchema(aiEstimatorAssemblyComponents).omit({ id: true, createdAt: true });
export type InsertAiEstimatorAssemblyComponent = z.infer<typeof insertAiEstimatorAssemblyComponentSchema>;
export type AiEstimatorAssemblyComponent = typeof aiEstimatorAssemblyComponents.$inferSelect;

// Org-level estimating factors — single row per org. Holds the
// configurable inputs that the draft generator applies automatically:
//   - waste_factors_by_category: jsonb map { CONCRETE: 0.05, ... }
//   - productivity_overrides: jsonb map { '03-30-00': { unit:'CY', perHour:1.2 } }
//   - city_cost_index_default: number multiplier (1.00 = national avg)
//   - prevailing_wage_default: boolean
// Per-project overrides live on the project row (out of scope this task).
export const aiEstimatorOrgFactors = pgTable("ai_estimator_org_factors", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  wasteFactorsByCategory: jsonb("waste_factors_by_category").default(sql`'{}'::jsonb`),
  productivityOverrides: jsonb("productivity_overrides").default(sql`'{}'::jsonb`),
  cityCostIndexDefault: doublePrecision("city_cost_index_default").notNull().default(1.0),
  prevailingWageDefault: boolean("prevailing_wage_default").notNull().default(false),
  // Task #2576 — Roll-up factors applied in estimate totals + exports.
  // All values are percentages stored as fractions (0.10 = 10%).
  // Defaults of 0 mean "no markup applied" so existing tenants are
  // unaffected until they configure values via the settings UI.
  laborBurdenPercent: doublePrecision("labor_burden_percent").notNull().default(0),
  smallToolsPercent: doublePrecision("small_tools_percent").notNull().default(0),
  overheadPercent: doublePrecision("overhead_percent").notNull().default(0),
  profitPercent: doublePrecision("profit_percent").notNull().default(0),
  bondPercent: doublePrecision("bond_percent").notNull().default(0),
  escalationPercent: doublePrecision("escalation_percent").notNull().default(0),
  // Org-wide default waste factor surfaced as a single trust-setting
  // alongside the other markups. Per-category overrides still live in
  // `wasteFactorsByCategory` and win when set.
  defaultWasteFactor: doublePrecision("default_waste_factor").notNull().default(0),
  // Task #2627 — quality filter for the learned-rates pool. When true,
  // samples whose source bid is LOST or CANCELLED (or whose source
  // project's originating bid was) are excluded from rate recompute.
  // Defaults to true so new orgs benefit immediately; existing orgs can
  // opt out from the settings UI.
  excludeCancelledLostJobs: boolean("exclude_cancelled_lost_jobs").notNull().default(true),
  // Task #2628 — Per-trade calibration factors written when an admin
  // accepts a `ai_estimator_calibration_nudges` row. Keyed by trade enum
  // value, e.g. `{ "ELECTRICAL": { "quantity_bias": 1.08 } }`. Surfaced
  // back into the takeoff-draft prompt so the next draft inherits the
  // bias correction.
  tradeCalibrationFactors: jsonb("trade_calibration_factors").notNull().default(sql`'{}'::jsonb`),
  // Task #2623 — Per-org threshold below which an AI sheet
  // classification is surfaced in the review queue. Default 0.6 means
  // anything under 60% confidence needs human confirmation.
  lowConfidenceThreshold: doublePrecision("low_confidence_threshold").notNull().default(0.6),
  // Task #2626 — Per-org cap on the number of map-reduce LLM batches the
  // AI Estimator may run for any single discipline on one draft. Replaces
  // the hardcoded MAX_DISCIPLINE_BATCHES=25 in mapReduceDraft.ts so admins
  // can raise the cap on a heavy plan set or lower it to throttle spend
  // without a code change. 1..200; 25 keeps existing behaviour.
  maxDisciplineBatches: integer("max_discipline_batches").notNull().default(25),
  notes: text("notes"),
  updatedById: varchar("updated_by_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  uniqOrg: uniqueIndex("ai_estimator_org_factors_uniq_org").on(table.organizationId),
}));
export const insertAiEstimatorOrgFactorsSchema = createInsertSchema(aiEstimatorOrgFactors).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertAiEstimatorOrgFactors = z.infer<typeof insertAiEstimatorOrgFactorsSchema>;
export type AiEstimatorOrgFactors = typeof aiEstimatorOrgFactors.$inferSelect;

// Task #2627 — Per-org region factors. Each row is a named region
// (metro / state / custom) with a multiplier applied to learned-rate
// values when surfaced to estimators on a project tagged to that
// region. Multiplier is a positive number (1.0 = national avg / no
// adjustment). `isActive=false` archives the row without deleting it
// so historical projects keep their reference.
export const aiEstimatorRegionFactors = pgTable("ai_estimator_region_factors", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  regionType: text("region_type").notNull().default("CUSTOM"), // 'METRO' | 'STATE' | 'CUSTOM'
  code: text("code"), // optional short code (e.g. metro abbr / state code)
  multiplier: doublePrecision("multiplier").notNull().default(1.0),
  notes: text("notes"),
  isActive: boolean("is_active").notNull().default(true),
  createdById: varchar("created_by_id").references(() => users.id, { onDelete: "set null" }),
  updatedById: varchar("updated_by_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  orgIdx: index("ai_estimator_region_factors_org_idx").on(table.organizationId),
  uniqOrgName: uniqueIndex("ai_estimator_region_factors_uniq_name").on(table.organizationId, table.name),
}));
export const insertAiEstimatorRegionFactorSchema = createInsertSchema(aiEstimatorRegionFactors).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertAiEstimatorRegionFactor = z.infer<typeof insertAiEstimatorRegionFactorSchema>;
export type AiEstimatorRegionFactor = typeof aiEstimatorRegionFactors.$inferSelect;

// =====================================================================
// Task #2628 — AI takeoff calibration feedback loop.
//
// Three tables that close the loop between user reviews on
// `ai_takeoff_suggestions` and the next draft:
//
//   * `ai_estimator_calibration_exemplars` — curated few-shot set
//     (recent ACCEPTED / EDITED / REJECTED rows) per (org, trade),
//     refreshed nightly and injected into the takeoff-draft prompt.
//   * `ai_estimator_calibration_nudges` — admin-reviewable per-trade
//     bias suggestions. Accepting writes the factor into
//     `ai_estimator_org_factors.trade_calibration_factors`.
//   * `ai_estimator_accuracy_snapshots` — daily accuracy / acceptance
//     / MAPE roll-ups powering the per-org trend dashboard.
// =====================================================================
export const aiEstimatorCalibrationExemplars = pgTable("ai_estimator_calibration_exemplars", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  tradeType: text("trade_type"),
  kind: text("kind").notNull(), // 'ACCEPTED' | 'EDITED' | 'REJECTED'
  label: text("label").notNull(),
  itemType: text("item_type"),
  unit: text("unit"),
  originalQuantity: doublePrecision("original_quantity"),
  finalQuantity: doublePrecision("final_quantity"),
  rejectReason: text("reject_reason"),
  comment: text("comment"),
  sourceSuggestionId: varchar("source_suggestion_id"),
  generatedAt: timestamp("generated_at").notNull().defaultNow(),
}, (table) => ({
  orgTradeIdx: index("ai_estimator_calib_exemplar_org_trade_idx").on(table.organizationId, table.tradeType),
}));
export type AiEstimatorCalibrationExemplar = typeof aiEstimatorCalibrationExemplars.$inferSelect;
export type InsertAiEstimatorCalibrationExemplar = typeof aiEstimatorCalibrationExemplars.$inferInsert;

export const aiEstimatorCalibrationNudges = pgTable("ai_estimator_calibration_nudges", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  tradeType: text("trade_type"),
  metric: text("metric").notNull(), // 'quantity_bias' | 'unit_cost_bias' | 'labor_bias'
  unit: text("unit"),
  suggestedFactor: doublePrecision("suggested_factor").notNull(),
  basis: text("basis").notNull(),
  sampleSize: integer("sample_size").notNull(),
  status: text("status").notNull().default("PENDING"), // 'PENDING' | 'ACCEPTED' | 'REJECTED'
  reviewedById: varchar("reviewed_by_id").references(() => users.id, { onDelete: "set null" }),
  reviewedAt: timestamp("reviewed_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  orgStatusIdx: index("ai_estimator_calib_nudge_org_status_idx").on(table.organizationId, table.status),
}));
export type AiEstimatorCalibrationNudge = typeof aiEstimatorCalibrationNudges.$inferSelect;
export type InsertAiEstimatorCalibrationNudge = typeof aiEstimatorCalibrationNudges.$inferInsert;

export const aiEstimatorAccuracySnapshots = pgTable("ai_estimator_accuracy_snapshots", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  tradeType: text("trade_type"),
  windowStart: timestamp("window_start").notNull(),
  windowEnd: timestamp("window_end").notNull(),
  totalSuggestions: integer("total_suggestions").notNull().default(0),
  acceptedCount: integer("accepted_count").notNull().default(0),
  editedCount: integer("edited_count").notNull().default(0),
  rejectedCount: integer("rejected_count").notNull().default(0),
  acceptanceRate: doublePrecision("acceptance_rate"),
  mape: doublePrecision("mape"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  orgWindowIdx: index("ai_estimator_accuracy_org_window_idx").on(table.organizationId, table.windowEnd),
}));
export type AiEstimatorAccuracySnapshot = typeof aiEstimatorAccuracySnapshots.$inferSelect;
export type InsertAiEstimatorAccuracySnapshot = typeof aiEstimatorAccuracySnapshots.$inferInsert;

// Sheet-discipline whitelist for prompt validation. Anything else is
// stored as 'O' (other). Matches the AIA convention.
export const SHEET_DISCIPLINES = [
  "G", // General
  "A", // Architectural
  "S", // Structural
  "M", // Mechanical
  "E", // Electrical
  "P", // Plumbing
  "C", // Civil
  "L", // Landscape
  "FP", // Fire Protection
  "T", // Telecom / Low Voltage
  "Q", // Equipment
  "I", // Interiors
  "O", // Other
] as const;
export type SheetDiscipline = (typeof SHEET_DISCIPLINES)[number];

export const SHEET_DISCIPLINE_SOURCES = [
  "AI_DETECTED",
  "FILENAME_HEURISTIC",
  "USER",
] as const;
export type SheetDisciplineSource = (typeof SHEET_DISCIPLINE_SOURCES)[number];

// =====================================================================
// Task #2625 — Auto-takeoff revision history & diff view.
//
// Each successful auto-takeoff run is captured as an immutable revision
// snapshot so estimators can pick two runs and compare line-item /
// quantity drift before promoting the new numbers into the live
// takeoff. Revisions are append-only (no UPDATE/DELETE routes) so the
// audit trail stays intact.
// =====================================================================
export const aiTakeoffRevisions = pgTable("ai_takeoff_revisions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  bidId: varchar("bid_id").notNull().references(() => bids.id, { onDelete: "cascade" }),
  createdById: varchar("created_by_id").references(() => users.id, { onDelete: "set null" }),
  // 'map_reduce' (current default) or 'single' (legacy single-shot drafter).
  mode: text("mode").notNull().default("map_reduce"),
  // Snapshot of the plan-set at draft time. Shape:
  //   { planDocuments: Array<{ id, fileName, updatedAt? }>,
  //     sheets: Array<{ id, planId, sheetIndex, sheetNumber, sheetName,
  //                     discipline, revisionLabel }>,
  //     hash: string  // stable hash of the above for fast equality
  //   }
  planSetVersion: jsonb("plan_set_version"),
  // Provider model id (e.g. "claude-sonnet-4-5") and prompt version
  // ("mr-v1") so a revision can be traced back to the exact run.
  modelId: text("model_id"),
  promptVersion: text("prompt_version"),
  provider: text("provider"),
  // Restricted disciplines for this run (e.g. ["A","S"]); null = all.
  disciplines: jsonb("disciplines"),
  // Full measurement snapshot — array of MapReduceMeasurement rows.
  measurements: jsonb("measurements").notNull().default(sql`'[]'::jsonb`),
  notes: text("notes"),
  confidence: integer("confidence"),
  disciplineCoverage: jsonb("discipline_coverage"),
  llmCallCount: integer("llm_call_count"),
  partial: boolean("partial").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  orgIdx: index("ai_takeoff_revisions_org_idx").on(table.organizationId),
  bidIdx: index("ai_takeoff_revisions_bid_idx").on(table.bidId),
  createdAtIdx: index("ai_takeoff_revisions_created_at_idx").on(table.createdAt),
}));
export const insertAiTakeoffRevisionSchema = createInsertSchema(aiTakeoffRevisions).omit({ id: true, createdAt: true });
export type InsertAiTakeoffRevision = z.infer<typeof insertAiTakeoffRevisionSchema>;
export type AiTakeoffRevision = typeof aiTakeoffRevisions.$inferSelect;

// =====================================================================
// Task #2703 — AI Estimator Skills System.
//
// Structured knowledge units (methodology rules, exclusion clauses,
// risk flags, unit-cost anchors) that are applied to every relevant
// estimate. Scoped by trade, CSI division, or project type and ordered
// by priority so conflicting rules resolve predictably.
//
// `organizationId` is nullable for the system-seeded read-only trade
// packs which live at org=NULL and are merged into every org's skill
// list at retrieval time. User-authored skills always have an orgId.
// =====================================================================
export const aiEstimatorSkills = pgTable("ai_estimator_skills", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").references(() => organizations.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description"),
  ruleBody: text("rule_body").notNull(),
  scope: text("scope").notNull().default("global"), // 'global' | 'trade' | 'csi_division' | 'project_type'
  scopeValue: text("scope_value"),
  priority: integer("priority").notNull().default(100),
  isActive: boolean("is_active").notNull().default(true),
  isReadOnly: boolean("is_read_only").notNull().default(false),
  sourceType: text("source_type").notNull().default("user_authored"), // 'user_authored' | 'promoted_lesson' | 'seeded'
  sourceLessonId: varchar("source_lesson_id"),
  createdById: varchar("created_by_id").references(() => users.id, { onDelete: "set null" }),
  deletedAt: timestamp("deleted_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  orgIdx: index("ai_estimator_skills_org_idx").on(table.organizationId),
  orgActiveIdx: index("ai_estimator_skills_org_active_idx").on(table.organizationId, table.isActive),
  priorityIdx: index("ai_estimator_skills_priority_idx").on(table.priority),
}));
export const insertAiEstimatorSkillSchema = createInsertSchema(aiEstimatorSkills).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertAiEstimatorSkill = z.infer<typeof insertAiEstimatorSkillSchema>;
export type AiEstimatorSkill = typeof aiEstimatorSkills.$inferSelect;
