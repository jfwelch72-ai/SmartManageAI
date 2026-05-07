// AUTO-GENERATED SPLIT FROM shared/schema/features.ts (Task #2426).
// Domain bucketing rule lives in shared/schema/features/index.ts.
import { sql } from "drizzle-orm";
import { pgTable, text, varchar, boolean, timestamp, date, decimal, integer, pgEnum, doublePrecision, index, unique, uniqueIndex, json, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod";
import { addendumRecipientTypeEnum, addendumStatusEnum, aiBidDocumentAnalysisStatusEnum, aiCoDraftStatusEnum, aiContractDocumentAnalysisStatusEnum, contractStatusEnum, contractTypeEnum, contractRedlineStatusEnum, contractApprovalDecisionEnum, clauseCategoryEnum, signatureRequestStatusEnum, signerStatusEnum, aiInsightModuleEnum, aiInsightSeverityEnum, aiTakeoffModeEnum, aiTakeoffStatusEnum, aiTakeoffSuggestionStatusEnum, aiTakeoffRejectReasonEnum, aiTaskPriorityEnum, aiTaskStatusEnum, approvalEntityTypeEnum, approvalStatusEnum, atsProviderEnum, bidEquipmentSourceEnum, bidInvitationStatusEnum, bidRequestStatusEnum, bidResponseStatusEnum, blogCommentStatusEnum, blogPostStatusEnum, conversationTypeEnum, crewAvailabilityStatusEnum, crmActivityTypeEnum, crmCallDirectionEnum, crmCallOutcomeEnum, crmCallStatusEnum, crmCustomFieldEntityEnum, crmCustomFieldTypeEnum, crmContactRoleEnum, crmNoteTypeEnum, crmOrgStatusEnum, crmOrganisationTypeEnum, crmPipelineStageEnum, crmPreferredContactEnum, crmLostCategoryEnum, crmQuoteAcceptanceStatusEnum, crmLeadScoringOperatorEnum, crmSequenceStatusEnum, crmSequenceStepTypeEnum, crmSequenceEnrollmentStatusEnum, crmSequenceExecutionStatusEnum, crmSequenceEmailEventTypeEnum, crmSequenceExitReasonEnum, crmQuoteApprovalStatusEnum, dataSubjectRequestStatusEnum, dataSubjectRequestTypeEnum, documentRevisionSourceEnum, documentRevisionStatusEnum, emailClassificationEnum, emailProviderEnum, emailTaskSourceEnum, emailThreadStatusEnum, hiringActivityTypeEnum, hiringCandidateStageEnum, hiringCompensationTypeEnum, hiringEmploymentTypeEnum, hiringInterviewStatusEnum, hiringJobStatusEnum, hiringSyncStatusEnum, hustlerDelegateRoleEnum, hustlerLinkRequestStatusEnum, installationStatusEnum, lidarScanStatusEnum, lidarAnnotationTypeEnum, lidarComparisonTypeEnum, unifiedPaymentMethodEnum, unifiedPaymentStatusEnum, invoiceTypeEnum, integrationConnectionStatusEnum, integrationEventStatusEnum, integrationProviderEnum, issueSeverityEnum, issueStatusEnum, jobsiteAnalysisStatusEnum, lienWaiverStatusEnum, lienWaiverTypeEnum, locationLevelEnum, maintenanceTypeEnum, measurementReviewStatusEnum, measurementSourceEnum, measurementStatusEnum, measurementTypeEnum, takeoffVersionStatusEnum, messageEntityTypeEnum, mobilePlatformEnum, offlineEntityTypeEnum, offlineOperationTypeEnum, offlineSyncStatusEnum, organizationDocumentTypeEnum, organizationDocumentVisibilityEnum, overheadCostActionEnum, overheadCostCategoryEnum, overheadCostFrequencyEnum, portalChatPriorityEnum, portalChatThreadCategoryEnum, portalChatThreadStatusEnum, pricebookImportJobStatusEnum, pricebookStatusEnum, pricingApprovalStatusEnum, pricingSourceTypeEnum, projectEquipmentPlanStatusEnum, repairStatusEnum, retentionActionEnum, retentionEntityTypeEnum, rewardTypeEnum, rfiCategoryEnum, rfiPriorityEnum, rfiStatusEnum, scheduleDependencyTypeEnum, scheduleGeneratedByEnum, scheduleTaskStatusEnum, socialAccountStatusEnum, socialPlatformEnum, socialPostStatusEnum, sovPaymentMethodEnum, sovStatusEnum, storedMaterialStatusEnum, retentionReleaseTypeEnum, retentionReleaseStatusEnum, sowAuditActionEnum, ssoProviderEnum, submittalCategoryEnum, submittalItemStatusEnum, submittalPhaseEnum, submittalReviewRoleEnum, submittalReviewStatusEnum, submittalStatusEnum, submittalTypeEnum, syncStatusEnum, tradeTypeEnum, transmittalStatusEnum, userRoleEnum, vendorEnrollmentStatusEnum, voiceLogStatusEnum, websiteDeploymentActionEnum, websitePageTypeEnum, websiteProjectStatusEnum, websiteStatusEnum, takeoffIssueCategoryEnum, takeoffIssueStatusEnum, talentAvailabilityEnum, talentProfileVisibilityEnum, workflowEntityTypeEnum, riskCategoryEnum, riskStatusEnum, workflowTemplateStatusEnum, workflowInstanceStatusEnum, videoCallStatusEnum, workflowNotificationChannelEnum, dotAgencyKindEnum, dotPayItemTypeEnum, dbeCertificationTypeEnum, suretyBondTypeEnum, suretyBondStatusEnum, haulTicketStatusEnum, swpppInspectionTypeEnum, idrStatusEnum, buyAmericaStatusEnum } from "../enums";
import { bids, organizations, projects, users } from "../core";
import { changeOrders, estimateLineItems, estimates, planDocuments, projectInspections, tasks, tmTickets } from "../operations";
import { customLibraries } from "./library";



// ==================================================
// TAKEOFF + ESTIMATING ENGINE TABLES
// ==================================================

// Enums for takeoff and estimating
export const projectPlans = pgTable("project_plans", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  documentId: varchar("document_id").references(() => planDocuments.id, { onDelete: "set null" }),
  originalPdfUrl: text("original_pdf_url").notNull(),
  fileName: text("file_name").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Quantity Categories table (for organizing measurements by scope/type)
export const quantityCategories = pgTable("quantity_categories", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: varchar("project_id").references(() => projects.id, { onDelete: "cascade" }),
  bidId: varchar("bid_id").references(() => bids.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  color: text("color").notNull().default("#3b82f6"),
  lineStyle: text("line_style").notNull().default("solid"),
  lineWidth: integer("line_width").notNull().default(3),
  wasteFactor: doublePrecision("waste_factor").notNull().default(0),
  unitCost: doublePrecision("unit_cost"),
  displayOrder: integer("display_order").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  projectIdx: index("quantity_categories_project_idx").on(table.projectId),
  bidIdx: index("quantity_categories_bid_idx").on(table.bidId),
}));

// Task #2320 — Sheet-scale provenance + revision-drift detection.
// `scaleSource` records HOW a sheet got its current calibration so
// the bottom-bar chip + drift banner can speak to the user in the
// same vocabulary the calibration UI used. `scaleConfidence` is a
// coarsened version of the AI detector's confidence band; it's also
// what the supersede flow downgrades to UNVERIFIED to force
// re-verification on revisions. Defaults are UNVERIFIED so existing
// rows + brand-new uncalibrated sheets never get a fake green dot.
export const TAKEOFF_SCALE_SOURCES = [
  "USER_TWO_POINT",
  "STANDARD_SCALE",
  "AI_DETECTED",
  "INHERITED_FROM_PARENT",
  "BULK_PROPAGATED",
  "UNVERIFIED",
] as const;
export type TakeoffScaleSource = (typeof TAKEOFF_SCALE_SOURCES)[number];

export const TAKEOFF_SCALE_CONFIDENCES = [
  "HIGH",
  "MEDIUM",
  "LOW",
  "UNVERIFIED",
] as const;
export type TakeoffScaleConfidence = (typeof TAKEOFF_SCALE_CONFIDENCES)[number];

// Takeoff Sheets table (per-page images from PDFs)
export const takeoffSheets = pgTable("takeoff_sheets", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: varchar("project_id").references(() => projects.id, { onDelete: "cascade" }),
  bidId: varchar("bid_id").references(() => bids.id, { onDelete: "cascade" }),
  // Task #2403 — Standalone Takeoff Tool. When non-null, the sheet
  // belongs to a standalone takeoff (no bid/project required); the
  // forward reference is enforced via FK installed at startup.
  standaloneTakeoffId: varchar("standalone_takeoff_id"),
  planId: varchar("plan_id").references(() => projectPlans.id, { onDelete: "cascade" }),
  imageUrl: text("image_url").notNull(),
  sheetIndex: integer("sheet_index").notNull().default(0),
  sheetName: text("sheet_name"),
  scalePxPerFoot: doublePrecision("scale_px_per_foot"),
  units: text("units").notNull().default("ft"),
  folderGroup: text("folder_group").notNull().default("Plans"),
  revisionLabel: text("revision_label"),
  isActive: boolean("is_active").notNull().default(true),
  supersededById: varchar("superseded_by_id"),
  rotation: integer("rotation").notNull().default(0),
  scaleLabel: text("scale_label"),
  // Task #2320 — Provenance + drift tracking. Stored as plain text
  // (not pgEnum) so we don't have to thread an ALTER TYPE migration
  // through every existing tenant the next time the source set
  // grows. The whitelist lives in TAKEOFF_SCALE_SOURCES /
  // TAKEOFF_SCALE_CONFIDENCES above; routes validate against those.
  scaleSource: text("scale_source").notNull().default("UNVERIFIED"),
  scaleConfidence: text("scale_confidence").notNull().default("UNVERIFIED"),
  scaleCalibratedById: varchar("scale_calibrated_by_id").references(() => users.id, { onDelete: "set null" }),
  scaleCalibratedAt: timestamp("scale_calibrated_at"),
  scaleLockedToRevision: boolean("scale_locked_to_revision").notNull().default(false),
  // Task #2466 Phase 1 — Sheet indexing & trade routing. AIA-style
  // discipline classification (A, S, M, E, P, C, L, FP, T, Q, G, O...)
  // and the sheet number ("M-101", "S2.01"). Populated by the AI sheet
  // index pass; nullable for un-indexed sheets and overridable by users.
  discipline: text("discipline"),
  sheetNumber: text("sheet_number"),
  // Coarse confidence band ("HIGH" | "MEDIUM" | "LOW") and provenance
  // ("AI_DETECTED" | "USER" | "FILENAME_HEURISTIC").
  disciplineConfidence: text("discipline_confidence"),
  disciplineSource: text("discipline_source"),
  // Task #2577 Phase B — Per-page extracted text. Populated by the
  // document extractor on first read of a plan PDF (text layer or OCR
  // fallback). Shape: { "1": "page 1 text", "2": "page 2 text" } where
  // keys are 1-indexed page numbers as strings. Used by sheet indexing,
  // map-reduce drafter, and schedule symbol extractor so they don't
  // each pay for a fresh PDF render. Source flag tracks whether the
  // text came from the embedded layer ("PDF_TEXT") or an OCR provider
  // ("OCR_<providerId>").
  extractedTextByPage: jsonb("extracted_text_by_page"),
  extractedTextSource: text("extracted_text_source"),
  extractedTextAt: timestamp("extracted_text_at"),
  assignedTo: varchar("assigned_to"),
  completionStatus: text("completion_status").notNull().default("not_started"),
  targetMeasurements: integer("target_measurements"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  projectIdx: index("takeoff_sheets_project_idx").on(table.projectId),
  bidIdx: index("takeoff_sheets_bid_idx").on(table.bidId),
  planIdx: index("takeoff_sheets_plan_idx").on(table.planId),
}));

// Takeoff Measurement Groups table
export const takeoffMeasurementGroups = pgTable("takeoff_measurement_groups", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  projectId: varchar("project_id").references(() => projects.id, { onDelete: "cascade" }),
  bidId: varchar("bid_id").references(() => bids.id, { onDelete: "cascade" }),
  sheetId: varchar("sheet_id").references(() => takeoffSheets.id, { onDelete: "cascade" }),
  sortOrder: integer("sort_order").notNull().default(0),
  color: text("color").notNull().default("#6b7280"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  projectIdx: index("takeoff_measurement_groups_project_idx").on(table.projectId),
  bidIdx: index("takeoff_measurement_groups_bid_idx").on(table.bidId),
  sheetIdx: index("takeoff_measurement_groups_sheet_idx").on(table.sheetId),
}));

// Takeoff Versions table - tracks version snapshots per sheet
export const takeoffVersions = pgTable("takeoff_versions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: varchar("project_id").references(() => projects.id, { onDelete: "cascade" }),
  bidId: varchar("bid_id").references(() => bids.id, { onDelete: "cascade" }),
  sheetId: varchar("sheet_id").references(() => takeoffSheets.id, { onDelete: "cascade" }),
  versionNumber: integer("version_number").notNull().default(1),
  status: takeoffVersionStatusEnum("status").notNull().default("DRAFT"),
  createdById: varchar("created_by_id").references(() => users.id, { onDelete: "set null" }),
  label: text("label"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  projectIdx: index("takeoff_versions_project_idx").on(table.projectId),
  bidIdx: index("takeoff_versions_bid_idx").on(table.bidId),
  sheetIdx: index("takeoff_versions_sheet_idx").on(table.sheetId),
}));

// Project Locations table (hierarchical: Building > Floor > Room/Zone)
export const projectLocations = pgTable("project_locations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  parentId: varchar("parent_id"),
  name: text("name").notNull(),
  level: locationLevelEnum("level").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  description: text("description"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  projectIdx: index("project_locations_project_idx").on(table.projectId),
  parentIdx: index("project_locations_parent_idx").on(table.parentId),
  levelIdx: index("project_locations_level_idx").on(table.level),
}));

export const insertProjectLocationSchema = createInsertSchema(projectLocations).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertProjectLocation = z.infer<typeof insertProjectLocationSchema>;
export type ProjectLocation = typeof projectLocations.$inferSelect;

// Takeoff Measurements table
export const takeoffMeasurements = pgTable("takeoff_measurements", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  sheetId: varchar("sheet_id").notNull().references(() => takeoffSheets.id, { onDelete: "cascade" }),
  categoryId: varchar("category_id").references(() => quantityCategories.id, { onDelete: "set null" }),
  groupId: varchar("group_id").references(() => takeoffMeasurementGroups.id, { onDelete: "set null" }),
  takeoffVersionId: varchar("takeoff_version_id").references(() => takeoffVersions.id, { onDelete: "set null" }),
  locationId: varchar("location_id").references(() => projectLocations.id, { onDelete: "set null" }),
  type: measurementTypeEnum("type").notNull(),
  label: text("label").notNull(),
  points: text("points").notNull(),
  arcData: text("arc_data"),
  depthFeet: doublePrecision("depth_feet"),
  count: doublePrecision("count"),
  note: text("note"),
  color: text("color").default("#3b82f6"),
  visible: boolean("visible").notNull().default(true),
  source: measurementSourceEnum("source").notNull().default("USER"),
  status: measurementStatusEnum("status").notNull().default("DRAFT"),
  pitchRatio: text("pitch_ratio"),
  costCodeId: varchar("cost_code_id"),
  unitCost: doublePrecision("unit_cost"),
  lineStyle: text("line_style").notNull().default("solid"),
  lineWidth: integer("line_width").notNull().default(3),
  computedLengthFt: doublePrecision("computed_length_ft"),
  computedAreaFt2: doublePrecision("computed_area_ft2"),
  computedVolumeCy: doublePrecision("computed_volume_cy"),
  computedSurfaceAreaFt2: doublePrecision("computed_surface_area_ft2"),
  // Task #2326 — Per-measurement scale snapshot. When non-null this
  // measurement is "locked" to that exact px/ft value: subsequent
  // re-calibrations of the parent sheet must skip it during recompute,
  // so its computedLengthFt / computedAreaFt2 / etc. stay frozen at the
  // numbers the estimator approved when they originally drew it.
  // Set when the user picks "Lock existing measurements at current
  // scale" in the InlineCalibrationDrawer's re-calibration choice.
  lockedScalePxPerFoot: doublePrecision("locked_scale_px_per_foot"),
  deductions: text("deductions"),
  metadata: text("metadata"),
  // Task #2577 Phase B Step 4 — Idempotency anchor for AI-derived COUNT
  // measurements that originate from accepted schedule symbols
  // (`ai_estimator_legend_symbols.id`). A partial unique index on this
  // column lets `acceptScheduleSymbols` upsert instead of inserting a
  // duplicate row when the estimator re-runs the accept flow.
  sourceSymbolId: varchar("source_symbol_id"),
  subcontractorId: varchar("subcontractor_id"),
  supplierId: varchar("supplier_id"),
  locationTag: text("location_tag"),
  installationStatus: installationStatusEnum("installation_status").default("NOT_STARTED"),
  originMeasurementId: varchar("origin_measurement_id"),
  installedQuantity: doublePrecision("installed_quantity"),
  installedById: varchar("installed_by_id").references(() => users.id, { onDelete: "set null" }),
  installedAt: timestamp("installed_at"),
  photoUrls: text("photo_urls"),
  // Task #2319 — provenance: how this measurement's geometry was captured.
  // Enum-like text column (kept as text rather than a pgEnum so AI/import
  // pipelines can introduce new sources without requiring an enum
  // migration). Values: USER_TWO_POINT, STANDARD_SCALE, AI_DETECTED,
  // INHERITED_FROM_PARENT, BULK_PROPAGATED, UNCALIBRATED. Existing rows
  // backfill to UNCALIBRATED.
  calibrationSource: text("calibration_source").notNull().default("UNCALIBRATED"),
  // Task #2319 — immutable copy of the sheet-level scale at the moment
  // the measurement was committed. A re-calibration of the sheet does
  // NOT mutate these values, so historical quantities stay stable even
  // when the sheet's `scalePxPerFoot` is later corrected.
  scaleAtCaptureLabel: text("scale_at_capture_label"),
  scaleAtCapturePxPerFoot: doublePrecision("scale_at_capture_px_per_foot"),
  // Task #2319 — JSON array of the snap-mode strings actually hit on
  // each committed vertex during the draft (e.g. ["endpoint","midpoint",
  // null]). Stored as text to mirror `metadata`.
  snapModesUsed: text("snap_modes_used"),
  // Task #2319 — fraction of vertices (0..1) that landed on a real snap.
  // The reviewer threshold defaults to 0.6 below.
  snapHitRatio: doublePrecision("snap_hit_ratio"),
  // Task #2319 + #2321 — review queue plumbing. `needsReview` is flipped
  // at insert by the server-side #2319 rule (uncalibrated/AI source, low
  // snap ratio, or measurement $-value above the per-org threshold) and
  // also by the #2321 explicit "send to reviewer" right-click action.
  // `reviewStatus` carries the #2321 state machine:
  //   NULL → never queued (auto-flagged via #2319 rules)
  //   PENDING → explicit review request open
  //   APPROVED → reviewer approved (clears `needsReview`)
  //   REJECTED → reviewer rejected; keeps `needsReview = true` so the
  //   row stays in the queue until the requester fixes it.
  needsReview: boolean("needs_review").notNull().default(false),
  reviewStatus: measurementReviewStatusEnum("review_status"),
  reviewRequestedById: varchar("review_requested_by_id").references(() => users.id, { onDelete: "set null" }),
  reviewRequestedAt: timestamp("review_requested_at"),
  reviewerId: varchar("reviewer_id").references(() => users.id, { onDelete: "set null" }),
  reviewedById: varchar("reviewed_by_id").references(() => users.id, { onDelete: "set null" }),
  reviewedAt: timestamp("reviewed_at"),
  reviewNote: text("review_note"),
  // Task #2576 — Base-bid vs Change-Order scope. 'BASE' is the original
  // base-bid scope; 'CO' marks measurements that were added (or
  // re-categorised) into a change order. The CO is identified by
  // `changeOrderId`. Defaults keep existing rows on BASE.
  scopeTag: text("scope_tag").notNull().default("BASE"),
  changeOrderId: varchar("change_order_id"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  sheetIdx: index("takeoff_measurements_sheet_idx").on(table.sheetId),
  scopeTagIdx: index("takeoff_measurements_scope_tag_idx").on(table.scopeTag),
  changeOrderIdx: index("takeoff_measurements_change_order_idx").on(table.changeOrderId),
  categoryIdx: index("takeoff_measurements_category_idx").on(table.categoryId),
  groupIdx: index("takeoff_measurements_group_idx").on(table.groupId),
  locationIdx: index("takeoff_measurements_location_idx").on(table.locationId),
  typeIdx: index("takeoff_measurements_type_idx").on(table.type),
  statusIdx: index("takeoff_measurements_status_idx").on(table.status),
  versionIdx: index("takeoff_measurements_version_idx").on(table.takeoffVersionId),
  // Task #2319 + #2321 — partial index that backs both consumers:
  //   #2319: the upcoming sheet-scoped review-queue lookup (B-tree
  //          probe rather than full scan)
  //   #2321: the org-wide review queue query
  //          (`WHERE needs_review = true ORDER BY review_requested_at DESC`)
  // Partial keeps the index tiny because <1% of rows are queued at any
  // time. Indexed on `reviewRequestedAt` so the #2321 ORDER BY is also
  // index-served; sheet-scoped #2319 queries still benefit because the
  // partial predicate filters the row set first.
  needsReviewIdx: index("takeoff_measurements_needs_review_idx")
    .on(table.reviewRequestedAt)
    .where(sql`${table.needsReview} = true`),
}));

// Task #2319 — Provenance constants. `MEASUREMENT_CALIBRATION_SOURCES`
// is the closed set of values a client/server can write into
// `calibration_source`; anything else is rejected by the route. The
// snap-hit and review-value defaults are the server-side thresholds
// that flip `needsReview` at insert.
export const MEASUREMENT_CALIBRATION_SOURCES = [
  "USER_TWO_POINT",
  "STANDARD_SCALE",
  "AI_DETECTED",
  "INHERITED_FROM_PARENT",
  "BULK_PROPAGATED",
  "UNCALIBRATED",
] as const;
export const MEASUREMENT_NEEDS_REVIEW_SNAP_RATIO_THRESHOLD = 0.6;
export const MEASUREMENT_NEEDS_REVIEW_DEFAULT_VALUE_THRESHOLD = 25_000;

// Takeoff Markup Tool enum
export const takeoffMarkupToolEnum = pgEnum("takeoff_markup_tool", ["ARROW", "TEXT", "RECTANGLE", "CLOUD", "HIGHLIGHT", "FREEHAND"]);

// Takeoff Markups table
export const takeoffMarkups = pgTable("takeoff_markups", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  sheetId: varchar("sheet_id").notNull().references(() => takeoffSheets.id, { onDelete: "cascade" }),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  createdBy: varchar("created_by").notNull().references(() => users.id, { onDelete: "cascade" }),
  tool: takeoffMarkupToolEnum("tool").notNull(),
  points: text("points").notNull(),
  color: text("color").notNull().default("#ff0000"),
  thickness: integer("thickness").notNull().default(2),
  text: text("text"),
  categoryId: varchar("category_id").references(() => quantityCategories.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  sheetIdx: index("takeoff_markups_sheet_idx").on(table.sheetId),
  createdByIdx: index("takeoff_markups_created_by_idx").on(table.createdBy),
}));

export const insertTakeoffMarkupSchema = createInsertSchema(takeoffMarkups).omit({ id: true, createdAt: true });
export type InsertTakeoffMarkup = z.infer<typeof insertTakeoffMarkupSchema>;
export type TakeoffMarkup = typeof takeoffMarkups.$inferSelect;

export const takeoffSheetLinks = pgTable("takeoff_sheet_links", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  sourceSheetId: varchar("source_sheet_id").notNull().references(() => takeoffSheets.id, { onDelete: "cascade" }),
  targetSheetId: varchar("target_sheet_id").notNull().references(() => takeoffSheets.id, { onDelete: "cascade" }),
  x: doublePrecision("x").notNull(),
  y: doublePrecision("y").notNull(),
  width: doublePrecision("width").notNull(),
  height: doublePrecision("height").notNull(),
  label: text("label"),
  autoDetected: boolean("auto_detected").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  sourceSheetIdx: index("takeoff_sheet_links_source_idx").on(table.sourceSheetId),
  targetSheetIdx: index("takeoff_sheet_links_target_idx").on(table.targetSheetId),
}));

export const insertTakeoffSheetLinkSchema = createInsertSchema(takeoffSheetLinks).omit({ id: true, createdAt: true });
export type InsertTakeoffSheetLink = z.infer<typeof insertTakeoffSheetLinkSchema>;
export type TakeoffSheetLink = typeof takeoffSheetLinks.$inferSelect;

// Takeoff Issues table - flagged issues placed as pins on the plan canvas
export const takeoffIssues = pgTable("takeoff_issues", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  sheetId: varchar("sheet_id").notNull().references(() => takeoffSheets.id, { onDelete: "cascade" }),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  issueNumber: integer("issue_number").notNull(),
  category: takeoffIssueCategoryEnum("category").notNull().default("QUESTION"),
  severity: issueSeverityEnum("severity").notNull().default("MEDIUM"),
  status: takeoffIssueStatusEnum("status").notNull().default("OPEN"),
  assigneeId: varchar("assignee_id").references(() => users.id, { onDelete: "set null" }),
  description: text("description").notNull().default(""),
  position: text("position").notNull(),
  categoryId: varchar("category_id").references(() => quantityCategories.id, { onDelete: "set null" }),
  createdById: varchar("created_by_id").notNull().references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  sheetIdx: index("takeoff_issues_sheet_idx").on(table.sheetId),
  orgIdx: index("takeoff_issues_org_idx").on(table.organizationId),
  statusIdx: index("takeoff_issues_status_idx").on(table.status),
}));

// Takeoff Issue Comments table - threaded comments on issues
export const takeoffIssueComments = pgTable("takeoff_issue_comments", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  issueId: varchar("issue_id").notNull().references(() => takeoffIssues.id, { onDelete: "cascade" }),
  authorId: varchar("author_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  body: text("body").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  issueIdx: index("takeoff_issue_comments_issue_idx").on(table.issueId),
}));

export const insertTakeoffIssueSchema = createInsertSchema(takeoffIssues).omit({ id: true, createdAt: true, updatedAt: true, issueNumber: true });
export type InsertTakeoffIssue = z.infer<typeof insertTakeoffIssueSchema>;
export type TakeoffIssue = typeof takeoffIssues.$inferSelect;

export const insertTakeoffIssueCommentSchema = createInsertSchema(takeoffIssueComments).omit({ id: true, createdAt: true });
export type InsertTakeoffIssueComment = z.infer<typeof insertTakeoffIssueCommentSchema>;
export type TakeoffIssueComment = typeof takeoffIssueComments.$inferSelect;

export const bimExtractions = pgTable("bim_extractions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  bidId: varchar("bid_id").references(() => bids.id, { onDelete: "cascade" }),
  projectId: varchar("project_id").references(() => projects.id, { onDelete: "cascade" }),
  documentId: varchar("document_id"),
  documentName: text("document_name"),
  extractedData: text("extracted_data").notNull(),
  mappings: text("mappings"),
  importedAt: timestamp("imported_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  bidIdx: index("bim_extractions_bid_idx").on(table.bidId),
  projectIdx: index("bim_extractions_project_idx").on(table.projectId),
  documentIdx: index("bim_extractions_document_idx").on(table.documentId),
}));

export const insertBimExtractionSchema = createInsertSchema(bimExtractions).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertBimExtraction = z.infer<typeof insertBimExtractionSchema>;
export type BimExtraction = typeof bimExtractions.$inferSelect;

// Project Specs table (uploaded spec books)
export const projectSpecs = pgTable("project_specs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  fileUrl: text("file_url").notNull(),
  originalFileName: text("original_file_name").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Takeoff + Estimating Insert/Select Schemas
export const insertProjectPlanSchema = createInsertSchema(projectPlans).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertProjectPlan = z.infer<typeof insertProjectPlanSchema>;
export type ProjectPlan = typeof projectPlans.$inferSelect;

export const insertQuantityCategorySchema = createInsertSchema(quantityCategories).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertQuantityCategory = z.infer<typeof insertQuantityCategorySchema>;
export type QuantityCategory = typeof quantityCategories.$inferSelect;

export const insertTakeoffSheetSchema = createInsertSchema(takeoffSheets).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertTakeoffSheet = z.infer<typeof insertTakeoffSheetSchema>;
export type TakeoffSheet = typeof takeoffSheets.$inferSelect;

export const insertTakeoffVersionSchema = createInsertSchema(takeoffVersions).omit({ id: true, createdAt: true });
export type InsertTakeoffVersion = z.infer<typeof insertTakeoffVersionSchema>;
export type TakeoffVersion = typeof takeoffVersions.$inferSelect;

// Task #2319 — Base ZodObject (no transform) so the route handler can
// call `.partial()` on it for the per-id PATCH path. The transform
// that normalizes `snapModesUsed` from string[] → JSON-string lives
// on the exported schema below.
export const takeoffMeasurementSchemaBase = createInsertSchema(takeoffMeasurements).omit({ id: true, createdAt: true, updatedAt: true }).extend({
  // `calibrationSource` is constrained to the closed enum so a typo
  // on the client doesn't silently land garbage in the column.
  // `snapHitRatio` is clamped to 0..1 so a miscount on the client
  // can't accidentally write a value that breaks the >= threshold
  // rule. `snapModesUsed` is accepted as either a string-array
  // (preferred client shape) or a pre-stringified text payload
  // (mirrors how `metadata` and `points` are normalized on the
  // route boundary).
  calibrationSource: z.enum(MEASUREMENT_CALIBRATION_SOURCES).optional(),
  scaleAtCaptureLabel: z.string().max(64).nullish(),
  scaleAtCapturePxPerFoot: z.number().positive().finite().nullish(),
  snapModesUsed: z.union([z.string(), z.array(z.string().nullable())]).nullish(),
  snapHitRatio: z.number().min(0).max(1).nullish(),
});

const normalizeSnapModesUsed = <T extends { snapModesUsed?: unknown }>(value: T): T => {
  // Normalize `snapModesUsed` to its on-disk text representation so the
  // route handler doesn't have to special-case the array shape and the
  // db insert always sees a string. Handles the same array→json shape
  // the route already does for `points` and `metadata`.
  if (Array.isArray(value.snapModesUsed)) {
    return { ...value, snapModesUsed: JSON.stringify(value.snapModesUsed) };
  }
  return value;
};

export const insertTakeoffMeasurementSchema = takeoffMeasurementSchemaBase.transform(normalizeSnapModesUsed);
// Partial variant for PATCH: same field constraints, but every key
// optional and the transform reapplied so per-id edits that *do*
// include `snapModesUsed` (rare but possible from re-trace flows)
// land as a string in the DB.
export const updateTakeoffMeasurementSchema = takeoffMeasurementSchemaBase.partial().transform(normalizeSnapModesUsed);
export type InsertTakeoffMeasurement = z.infer<typeof insertTakeoffMeasurementSchema>;
export type TakeoffMeasurement = typeof takeoffMeasurements.$inferSelect;

export const insertTakeoffMeasurementGroupSchema = createInsertSchema(takeoffMeasurementGroups).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertTakeoffMeasurementGroup = z.infer<typeof insertTakeoffMeasurementGroupSchema>;
export type TakeoffMeasurementGroup = typeof takeoffMeasurementGroups.$inferSelect;

export const bimStoreyAssociations = pgTable("bim_storey_associations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  bidId: varchar("bid_id").references(() => bids.id, { onDelete: "cascade" }),
  projectId: varchar("project_id").references(() => projects.id, { onDelete: "cascade" }),
  sheetId: varchar("sheet_id").notNull().references(() => takeoffSheets.id, { onDelete: "cascade" }),
  bimDocumentId: varchar("bim_document_id").notNull(),
  storeyExpressId: integer("storey_express_id").notNull(),
  storeyName: text("storey_name").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  sheetIdx: index("bim_storey_assoc_sheet_idx").on(table.sheetId),
  bidIdx: index("bim_storey_assoc_bid_idx").on(table.bidId),
}));

export const insertBimStoreyAssociationSchema = createInsertSchema(bimStoreyAssociations).omit({ id: true, createdAt: true });
export type InsertBimStoreyAssociation = z.infer<typeof insertBimStoreyAssociationSchema>;
export type BimStoreyAssociation = typeof bimStoreyAssociations.$inferSelect;

// Takeoff Assemblies - reusable templates that auto-calculate quantities from a measurement
export const takeoffAssemblies = pgTable("takeoff_assemblies", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description"),
  tradeType: text("trade_type"),
  measurementType: text("measurement_type").notNull().default("LINEAR"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  orgIdx: index("takeoff_assemblies_org_idx").on(table.organizationId),
}));

export const insertTakeoffAssemblySchema = createInsertSchema(takeoffAssemblies).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertTakeoffAssembly = z.infer<typeof insertTakeoffAssemblySchema>;
export type TakeoffAssembly = typeof takeoffAssemblies.$inferSelect;

// Takeoff Assembly Items - individual line items within an assembly with quantity formulas
export const takeoffAssemblyItems = pgTable("takeoff_assembly_items", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  assemblyId: varchar("assembly_id").notNull().references(() => takeoffAssemblies.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description"),
  unit: text("unit").notNull(),
  formula: text("formula").notNull(),
  wasteFactor: doublePrecision("waste_factor").notNull().default(0),
  unitCost: decimal("unit_cost", { precision: 10, scale: 2 }),
  displayOrder: integer("display_order").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  assemblyIdx: index("takeoff_assembly_items_assembly_idx").on(table.assemblyId),
}));

export const insertTakeoffAssemblyItemSchema = createInsertSchema(takeoffAssemblyItems).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertTakeoffAssemblyItem = z.infer<typeof insertTakeoffAssemblyItemSchema>;
export type TakeoffAssemblyItem = typeof takeoffAssemblyItems.$inferSelect;

// Takeoff Measurement Assemblies - links a measurement to an assembly for computed quantities
export const takeoffMeasurementAssemblies = pgTable("takeoff_measurement_assemblies", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  measurementId: varchar("measurement_id").notNull().references(() => takeoffMeasurements.id, { onDelete: "cascade" }),
  assemblyId: varchar("assembly_id").notNull().references(() => takeoffAssemblies.id, { onDelete: "cascade" }),
  overrides: text("overrides"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  measurementIdx: index("takeoff_meas_assembly_meas_idx").on(table.measurementId),
  assemblyIdx: index("takeoff_meas_assembly_asm_idx").on(table.assemblyId),
}));

export const insertTakeoffMeasurementAssemblySchema = createInsertSchema(takeoffMeasurementAssemblies).omit({ id: true, createdAt: true });
export type InsertTakeoffMeasurementAssembly = z.infer<typeof insertTakeoffMeasurementAssemblySchema>;
export type TakeoffMeasurementAssembly = typeof takeoffMeasurementAssemblies.$inferSelect;

export const takeoffConditions = pgTable("takeoff_conditions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  measurementType: text("measurement_type").notNull(),
  color: text("color").notNull().default("#3b82f6"),
  categoryName: text("category_name"),
  unitCost: doublePrecision("unit_cost"),
  costCodeId: varchar("cost_code_id"),
  assemblyId: varchar("assembly_id"),
  lineStyle: text("line_style"),
  labelTemplate: text("label_template"),
  sortOrder: integer("sort_order").notNull().default(0),
  lastUsedAt: timestamp("last_used_at"),
  isFavorite: boolean("is_favorite").notNull().default(false),
  formula: text("formula"),
  assemblyComponents: text("assembly_components"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  orgIdx: index("takeoff_conditions_org_idx").on(table.organizationId),
  lastUsedIdx: index("takeoff_conditions_last_used_idx").on(table.lastUsedAt),
}));

export const insertTakeoffConditionSchema = createInsertSchema(takeoffConditions).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertTakeoffCondition = z.infer<typeof insertTakeoffConditionSchema>;
export type TakeoffCondition = typeof takeoffConditions.$inferSelect;

// ---------------------------------------------------------------------------
// Task #2065 — Tool Chest (Step 7)
//
// Per-user pinned shelf of frequently-used tools, conditions, and
// assemblies. Each row references one resource by `(itemKind, itemId)` so
// the same table can pin a built-in tool (kind="tool"), a saved
// condition (kind="condition"), or an assembly (kind="assembly").
//
// Items can be marked `isShared=true` to expose the pin to the whole
// organization; the routes layer enforces that only the owner (or an
// admin) can flip the flag.
// ---------------------------------------------------------------------------
export const takeoffToolChestItems = pgTable("takeoff_tool_chest_items", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  itemKind: text("item_kind").notNull(), // "tool" | "condition" | "assembly"
  itemId: text("item_id").notNull(),     // tool key (e.g. "linear") or UUID of condition/assembly
  label: text("label"),                   // optional override label
  color: text("color"),
  shortcut: text("shortcut"),             // optional single-key/Mod+key binding
  sortOrder: integer("sort_order").notNull().default(0),
  isShared: boolean("is_shared").notNull().default(false),
  lastUsedAt: timestamp("last_used_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  orgIdx: index("takeoff_tool_chest_items_org_idx").on(table.organizationId),
  userIdx: index("takeoff_tool_chest_items_user_idx").on(table.userId),
  uniquePerUser: uniqueIndex("takeoff_tool_chest_items_user_kind_id_uq").on(
    table.userId,
    table.itemKind,
    table.itemId,
  ),
}));

export const insertTakeoffToolChestItemSchema = createInsertSchema(takeoffToolChestItems).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertTakeoffToolChestItem = z.infer<typeof insertTakeoffToolChestItemSchema>;
export type TakeoffToolChestItem = typeof takeoffToolChestItems.$inferSelect;

// ---------------------------------------------------------------------------
// Task #2065 — Sheet Sets (Step 12)
//
// A Sheet Set is a named collection of takeoff sheets that share a
// workflow context (e.g. "Architectural — Foundation Plans"). Sheet Sets
// power bulk operations: applying a calibrated scale to every member,
// running condition takeoffs across the set, exporting consolidated
// reports, etc.
//
// Membership is order-preserving so the sidebar can render the set in a
// stable visual order. A sheet may belong to multiple sets.
// ---------------------------------------------------------------------------
export const takeoffSheetSets = pgTable("takeoff_sheet_sets", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  projectId: varchar("project_id").references(() => projects.id, { onDelete: "cascade" }),
  bidId: varchar("bid_id").references(() => bids.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description"),
  color: text("color").notNull().default("#3b82f6"),
  defaultScalePxPerFoot: doublePrecision("default_scale_px_per_foot"),
  defaultScaleLabel: text("default_scale_label"),
  sortOrder: integer("sort_order").notNull().default(0),
  createdBy: varchar("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  orgIdx: index("takeoff_sheet_sets_org_idx").on(table.organizationId),
  projectIdx: index("takeoff_sheet_sets_project_idx").on(table.projectId),
  bidIdx: index("takeoff_sheet_sets_bid_idx").on(table.bidId),
}));

export const insertTakeoffSheetSetSchema = createInsertSchema(takeoffSheetSets).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertTakeoffSheetSet = z.infer<typeof insertTakeoffSheetSetSchema>;
export type TakeoffSheetSet = typeof takeoffSheetSets.$inferSelect;

export const takeoffSheetSetMembers = pgTable("takeoff_sheet_set_members", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  setId: varchar("set_id").notNull().references(() => takeoffSheetSets.id, { onDelete: "cascade" }),
  sheetId: varchar("sheet_id").notNull().references(() => takeoffSheets.id, { onDelete: "cascade" }),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  setIdx: index("takeoff_sheet_set_members_set_idx").on(table.setId),
  sheetIdx: index("takeoff_sheet_set_members_sheet_idx").on(table.sheetId),
  uniqueMembership: uniqueIndex("takeoff_sheet_set_members_set_sheet_uq").on(
    table.setId,
    table.sheetId,
  ),
}));

export const insertTakeoffSheetSetMemberSchema = createInsertSchema(takeoffSheetSetMembers).omit({ id: true, createdAt: true });
export type InsertTakeoffSheetSetMember = z.infer<typeof insertTakeoffSheetSetMemberSchema>;
export type TakeoffSheetSetMember = typeof takeoffSheetSetMembers.$inferSelect;

export interface AssemblyComponent {
  id: string;
  name: string;
  measurementType: string;
  unit: string;
  unitCost: number;
  formula: string;
  wasteFactor: number;
}

export const savedScaleTemplates = pgTable("saved_scale_templates", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  label: text("label").notNull(),
  pxPerFoot: doublePrecision("px_per_foot").notNull(),
  category: text("category").notNull().default("custom"),
  isBuiltIn: boolean("is_built_in").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  orgIdx: index("saved_scale_templates_org_idx").on(table.organizationId),
}));

export const insertSavedScaleTemplateSchema = createInsertSchema(savedScaleTemplates).omit({ id: true, createdAt: true });
export type InsertSavedScaleTemplate = z.infer<typeof insertSavedScaleTemplateSchema>;
export type SavedScaleTemplate = typeof savedScaleTemplates.$inferSelect;

export const insertProjectSpecSchema = createInsertSchema(projectSpecs).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertProjectSpec = z.infer<typeof insertProjectSpecSchema>;
export type ProjectSpec = typeof projectSpecs.$inferSelect;

// Estimator Handoff Packet table - Job Information for QuickBooks setup
// Links to either a bid (during bidding) or project (after award)
export const handoffPackets = pgTable("handoff_packets", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  bidId: varchar("bid_id").references(() => bids.id, { onDelete: "cascade" }),
  projectId: varchar("project_id").references(() => projects.id, { onDelete: "cascade" }),
  
  // 1. Job Overview
  gcName: text("gc_name"),
  gcContactName: text("gc_contact_name"),
  gcPhone: text("gc_phone"),
  gcEmail: text("gc_email"),
  accessDetails: text("access_details"),
  scopeOfWorkSummary: text("scope_of_work_summary"),
  
  // 2. Estimate Snapshot
  contractValue: decimal("contract_value", { precision: 12, scale: 2 }),
  bidDate: date("bid_date"),
  awardDate: date("award_date"),
  markupPercent: decimal("markup_percent", { precision: 5, scale: 2 }),
  duration: text("duration"),
  projectStartDate: date("project_start_date"),
  projectCompletionDate: date("project_completion_date"),
  manpower: text("manpower"),
  alternates: text("alternates"),
  
  // 3. Contract & Documentation
  subcontractExecuted: boolean("subcontract_executed"),
  insuranceCerts: text("insurance_certs"),
  bondRequired: boolean("bond_required"),
  permits: text("permits"),
  retentionPercent: decimal("retention_percent", { precision: 5, scale: 2 }),
  paymentTerms: text("payment_terms"),
  scheduleOfValuesReady: boolean("schedule_of_values_ready"),
  drawSchedule: text("draw_schedule"),
  prevailingWage: boolean("prevailing_wage"),
  
  // 4. Materials & Supply Chain Plan
  concreteSupplier: text("concrete_supplier"),
  mixInfo: text("mix_info"),
  rebarVendor: text("rebar_vendor"),
  formingMaterialPlan: text("forming_material_plan"),
  curingSpecs: text("curing_specs"),
  specialItems: text("special_items"),
  leadTimeRisks: text("lead_time_risks"),
  submittalStatus: text("submittal_status"),
  
  // 5. Field Work Details
  layoutSurveyBy: text("layout_survey_by"),
  benchmarkInfo: text("benchmark_info"),
  accessZones: text("access_zones"),
  workHours: text("work_hours"),
  safetyOrientation: text("safety_orientation"),
  inspectionNeeds: text("inspection_needs"),
  
  // 6. Project Notes & Risk Items
  coordinationIssues: text("coordination_issues"),
  weatherRisks: text("weather_risks"),
  soilConditions: text("soil_conditions"),
  estimatorNotes: text("estimator_notes"),
  
  // 7. Communication Protocol
  gcContactMethod: text("gc_contact_method"),
  projectManager: text("project_manager"),
  superintendent: text("superintendent"),
  officeAdmin: text("office_admin"),
  safetyContact: text("safety_contact"),
  
  createdById: varchar("created_by_id").references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertHandoffPacketSchema = createInsertSchema(handoffPackets).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertHandoffPacket = z.infer<typeof insertHandoffPacketSchema>;
export type HandoffPacket = typeof handoffPackets.$inferSelect;

// ============================================================
// STANDARDIZED SCOPE OF WORK SYSTEM
// Admin-editable work types and modifiers for consistent AI tracking
// ============================================================

// Scope Work Type Categories (grouping similar work types)
export const scopeWorkTypeCategories = pgTable("scope_work_type_categories", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull().unique(), // e.g., "Sidewalk", "Driveway", "Curb & Gutter"
  displayOrder: integer("display_order").notNull().default(0),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Scope Work Types (admin-editable, used in dropdowns)
export const scopeWorkTypes = pgTable("scope_work_types", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  categoryId: varchar("category_id").notNull().references(() => scopeWorkTypeCategories.id, { onDelete: "cascade" }),
  name: text("name").notNull(), // e.g., "4\" Sidewalk", "6\" Driveway"
  code: text("code").notNull().unique(), // Machine-readable code for AI grouping: "sidewalk_4in"
  requiresDimensions: boolean("requires_dimensions").notNull().default(false), // For footings/foundations
  dimensionLabel: text("dimension_label"), // e.g., "L x W x D" or "L x H x Thickness"
  displayOrder: integer("display_order").notNull().default(0),
  isActive: boolean("is_active").notNull().default(true),
  isCustom: boolean("is_custom").notNull().default(false), // Admin-added custom types
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  categoryIdx: index("scope_work_types_category_idx").on(table.categoryId),
}));

// Scope Modifier Categories (grouping similar modifiers)
export const scopeModifierCategories = pgTable("scope_modifier_categories", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull().unique(), // e.g., "Reinforcement", "Mix Type", "Finish Type"
  displayOrder: integer("display_order").notNull().default(0),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Scope Modifiers (admin-editable, used in multi-select)
export const scopeModifiers = pgTable("scope_modifiers", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  categoryId: varchar("category_id").notNull().references(() => scopeModifierCategories.id, { onDelete: "cascade" }),
  name: text("name").notNull(), // e.g., "Rebar (#4)", "High Early", "Broom Finish"
  code: text("code").notNull().unique(), // Machine-readable: "rebar_4", "mix_high_early"
  displayOrder: integer("display_order").notNull().default(0),
  isActive: boolean("is_active").notNull().default(true),
  isCustom: boolean("is_custom").notNull().default(false), // Admin-added custom modifiers
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  categoryIdx: index("scope_modifiers_category_idx").on(table.categoryId),
}));

// Insert/Select Schemas for Scope System
export const insertScopeWorkTypeCategorySchema = createInsertSchema(scopeWorkTypeCategories).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertScopeWorkTypeCategory = z.infer<typeof insertScopeWorkTypeCategorySchema>;
export type ScopeWorkTypeCategory = typeof scopeWorkTypeCategories.$inferSelect;

export const insertScopeWorkTypeSchema = createInsertSchema(scopeWorkTypes).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertScopeWorkType = z.infer<typeof insertScopeWorkTypeSchema>;
export type ScopeWorkType = typeof scopeWorkTypes.$inferSelect;

export const insertScopeModifierCategorySchema = createInsertSchema(scopeModifierCategories).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertScopeModifierCategory = z.infer<typeof insertScopeModifierCategorySchema>;
export type ScopeModifierCategory = typeof scopeModifierCategories.$inferSelect;

export const insertScopeModifierSchema = createInsertSchema(scopeModifiers).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertScopeModifier = z.infer<typeof insertScopeModifierSchema>;
export type ScopeModifier = typeof scopeModifiers.$inferSelect;

// ============================================================
// MATERIAL CALCULATOR PRESETS
// Saved dimension configurations for work types
// ============================================================

// Material Calculator Presets - stores saved dimension configurations
export const materialCalculatorPresets = pgTable("material_calculator_presets", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  name: text("name").notNull(), // e.g., "Standard Curb 6x18", "Heavy Duty Sidewalk"
  workTypeCode: text("work_type_code"), // Optional link to specific work type code
  unit: text("unit").notNull(), // LF, SF, etc.
  
  // Concrete dimensions
  concreteDepthInches: decimal("concrete_depth_inches", { precision: 6, scale: 2 }),
  dimensionWidthInches: decimal("dimension_width_inches", { precision: 6, scale: 2 }),
  dimensionHeightInches: decimal("dimension_height_inches", { precision: 6, scale: 2 }),
  concreteWasteFactor: decimal("concrete_waste_factor", { precision: 5, scale: 2 }).default("10"),
  
  // Stone sub-base
  requiresStoneBase: boolean("requires_stone_base").default(false),
  stoneType: text("stone_type"),
  stoneSize: text("stone_size"), // Stone gradation: #304, #1, #2, #4, #57, #67, #8, etc.
  stoneDepthInches: decimal("stone_depth_inches", { precision: 6, scale: 2 }),
  stoneWasteFactor: decimal("stone_waste_factor", { precision: 5, scale: 2 }).default("10"),
  
  // Excavation
  requiresExcavation: boolean("requires_excavation").default(false),
  excavationDepthInches: decimal("excavation_depth_inches", { precision: 6, scale: 2 }),
  excavationWidthInches: decimal("excavation_width_inches", { precision: 6, scale: 2 }),
  excavationSwellFactor: decimal("excavation_swell_factor", { precision: 5, scale: 2 }).default("25"),
  
  // Wire mesh
  requiresWireMesh: boolean("requires_wire_mesh").default(false),
  wireMeshType: text("wire_mesh_type"),
  wireMeshWasteFactor: decimal("wire_mesh_waste_factor", { precision: 5, scale: 2 }).default("10"),
  
  // Rebar
  requiresRebar: boolean("requires_rebar").default(false),
  rebarSize: text("rebar_size"),
  rebarFabType: text("rebar_fab_type"), // Fabrication type: FIELD_TIED, PREFAB_MAT, PREFAB_CAGE, FIBER_MESH
  rebarSpacingInches: decimal("rebar_spacing_inches", { precision: 6, scale: 2 }),
  rebarWasteFactor: decimal("rebar_waste_factor", { precision: 5, scale: 2 }).default("10"),
  
  // Sealer
  requiresSealer: boolean("requires_sealer").default(false),
  sealerType: text("sealer_type"),
  sealerCoats: integer("sealer_coats").default(1),
  sealerWasteFactor: decimal("sealer_waste_factor", { precision: 5, scale: 2 }).default("10"),
  
  // Underlayment
  requiresUnderlayment: boolean("requires_underlayment").default(false),
  underlaymentType: text("underlayment_type"),
  underlaymentOverlapInches: decimal("underlayment_overlap_inches", { precision: 6, scale: 2 }),
  underlaymentWasteFactor: decimal("underlayment_waste_factor", { precision: 5, scale: 2 }).default("10"),
  
  // Metadata
  isDefault: boolean("is_default").default(false), // Mark as default preset for this work type
  createdById: varchar("created_by_id").references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  orgIdx: index("material_calc_presets_org_idx").on(table.organizationId),
  workTypeIdx: index("material_calc_presets_work_type_idx").on(table.workTypeCode),
}));

export const insertMaterialCalculatorPresetSchema = createInsertSchema(materialCalculatorPresets).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertMaterialCalculatorPreset = z.infer<typeof insertMaterialCalculatorPresetSchema>;
export type MaterialCalculatorPreset = typeof materialCalculatorPresets.$inferSelect;

// ============================================================
// MASTER MODIFIERS BY TRADE (Template Library)
// Trade-specific modifiers for scope standardization
// ============================================================

// Master Modifier Categories by Trade
export const masterModifierCategories = pgTable("master_modifier_categories", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tradeType: tradeTypeEnum("trade_type").notNull(),
  name: text("name").notNull(),
  description: text("description"),
  displayOrder: integer("display_order").notNull().default(0),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  tradeIdx: index("master_mod_cat_trade_idx").on(table.tradeType),
  nameTradeUnique: unique("master_mod_cat_name_trade_unique").on(table.tradeType, table.name),
}));

// Master Modifiers by Trade
export const masterModifiers = pgTable("master_modifiers", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tradeType: tradeTypeEnum("trade_type").notNull(),
  categoryId: varchar("category_id").notNull().references(() => masterModifierCategories.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  code: text("code").notNull(),
  description: text("description"),
  displayOrder: integer("display_order").notNull().default(0),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  tradeIdx: index("master_mod_trade_idx").on(table.tradeType),
  categoryIdx: index("master_mod_category_idx").on(table.categoryId),
  codeTradeUnique: unique("master_mod_code_trade_unique").on(table.tradeType, table.code),
}));

export const insertMasterModifierCategorySchema = createInsertSchema(masterModifierCategories).omit({ id: true, createdAt: true });
export type InsertMasterModifierCategory = z.infer<typeof insertMasterModifierCategorySchema>;
export type MasterModifierCategory = typeof masterModifierCategories.$inferSelect;

export const insertMasterModifierSchema = createInsertSchema(masterModifiers).omit({ id: true, createdAt: true });
export type InsertMasterModifier = z.infer<typeof insertMasterModifierSchema>;
export type MasterModifier = typeof masterModifiers.$inferSelect;

export const savedTakeoffs = pgTable("saved_takeoffs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 120 }).notNull(),
  projectId: integer("project_id"),
  sheetId: varchar("sheet_id"),
  measurementData: json("measurement_data"),
  libraryId: varchar("library_id").references(() => customLibraries.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  orgIdx: index("saved_takeoffs_org_idx").on(table.organizationId),
}));

export const insertSavedTakeoffSchema = createInsertSchema(savedTakeoffs).omit({ id: true, createdAt: true });
export type InsertSavedTakeoff = z.infer<typeof insertSavedTakeoffSchema>;
export type SavedTakeoff = typeof savedTakeoffs.$inferSelect;

// ── Scope Modifier System (3-Layer) ──────────────────────────────────────────

export const modifiers = pgTable("modifiers", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  category: text("category").notNull(),
  layer: text("layer").notNull(),
  tradeIds: text("trade_ids").array().notNull().default(sql`'{}'::text[]`),
  scopePatterns: text("scope_patterns").array().notNull().default(sql`'{}'::text[]`),
  uoms: text("uoms").array().notNull().default(sql`'{}'::text[]`),
  materialFamilies: text("material_families").array().notNull().default(sql`'{}'::text[]`),
  laborFactorMin: doublePrecision("labor_factor_min").notNull().default(1.0),
  laborFactorMax: doublePrecision("labor_factor_max").notNull().default(1.0),
  materialFactorMin: doublePrecision("material_factor_min").notNull().default(1.0),
  materialFactorMax: doublePrecision("material_factor_max").notNull().default(1.0),
  durationFactorMin: doublePrecision("duration_factor_min").notNull().default(1.0),
  durationFactorMax: doublePrecision("duration_factor_max").notNull().default(1.0),
  wasteFactorMin: doublePrecision("waste_factor_min").notNull().default(0.0),
  wasteFactorMax: doublePrecision("waste_factor_max").notNull().default(0.0),
  effectType: text("effect_type").notNull().default("mixed"),
  aiTags: text("ai_tags").array().notNull().default(sql`'{}'::text[]`),
  defaultBehavior: text("default_behavior").notNull().default("optional"),
  organizationId: varchar("organization_id").references(() => organizations.id, { onDelete: "cascade" }),
  isActive: boolean("is_active").notNull().default(true),
  displayOrder: integer("display_order").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  layerIdx: index("modifiers_layer_idx").on(table.layer),
  categoryIdx: index("modifiers_category_idx").on(table.category),
  orgIdx: index("modifiers_org_idx").on(table.organizationId),
  activeIdx: index("modifiers_active_idx").on(table.isActive),
}));

export const insertModifierSchema = createInsertSchema(modifiers).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertModifier = z.infer<typeof insertModifierSchema>;
export type Modifier = typeof modifiers.$inferSelect;

export const scopeModifierRules = pgTable("scope_modifier_rules", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  pattern: text("pattern").notNull(),
  matchType: text("match_type").notNull(),
  modifierIds: text("modifier_ids").array().notNull().default(sql`'{}'::text[]`),
  tradeIds: text("trade_ids").array().notNull().default(sql`'{}'::text[]`),
  priority: integer("priority").notNull().default(0),
  isActive: boolean("is_active").notNull().default(true),
}, (table) => ({
  activeIdx: index("scope_modifier_rules_active_idx").on(table.isActive),
  priorityIdx: index("scope_modifier_rules_priority_idx").on(table.priority),
}));

export const insertScopeModifierRuleSchema = createInsertSchema(scopeModifierRules).omit({
  id: true,
});
export type InsertScopeModifierRule = z.infer<typeof insertScopeModifierRuleSchema>;
export type ScopeModifierRule = typeof scopeModifierRules.$inferSelect;

export const bidModifierSelections = pgTable("bid_modifier_selections", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  bidId: varchar("bid_id").notNull().references(() => bids.id, { onDelete: "cascade" }),
  estimateLineItemId: varchar("estimate_line_item_id").notNull().references(() => estimateLineItems.id, { onDelete: "cascade" }),
  modifierId: varchar("modifier_id").notNull().references(() => modifiers.id, { onDelete: "cascade" }),
  selectedFactor: doublePrecision("selected_factor").notNull(),
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  bidIdx: index("bid_modifier_selections_bid_idx").on(table.bidId),
  lineItemIdx: index("bid_modifier_selections_line_item_idx").on(table.estimateLineItemId),
  modifierIdx: index("bid_modifier_selections_modifier_idx").on(table.modifierId),
}));

export const insertBidModifierSelectionSchema = createInsertSchema(bidModifierSelections).omit({
  id: true,
  createdAt: true,
});
export type InsertBidModifierSelection = z.infer<typeof insertBidModifierSelectionSchema>;
export type BidModifierSelection = typeof bidModifierSelections.$inferSelect;

// Task #2079 — Server-side persistence for the per-user "Recent" rail on the
// Takeoff landing page. The same data still lives in localStorage for
// instant UX, but rows here are the cross-device source of truth so a user
// who jumps between desktop and laptop sees the same recent bids/sheets.
//
// Task #2097 extended this with `pinnedAt`, `hidden`, and `updatedAt` so
// pin/remove state also follows the user across devices (previously those
// flags were only stored locally, defeating the cross-device promise).
//
// `kind` is the discriminator from RecentTakeoffEntry ("bid" | "project").
// `sheetId` is stored as the empty string when the entry refers to the
// workspace itself rather than a specific sheet — Postgres treats nullable
// columns as distinct in unique indexes, so coalescing to "" lets us use a
// straightforward unique constraint for upserts.
export const takeoffRecents = pgTable("takeoff_recents", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(),
  entityId: varchar("entity_id").notNull(),
  entityCode: text("entity_code").notNull(),
  entityName: text("entity_name"),
  sheetId: varchar("sheet_id").notNull().default(""),
  sheetName: text("sheet_name"),
  openedAt: timestamp("opened_at").notNull().defaultNow(),
  // Task #2097 — `pinnedAt` is a timestamp (null = not pinned) so the UI
  // can render pinned items chronologically by when they were pinned.
  // `hidden` acts as a tombstone for "Remove from list" so the entry
  // stays gone across devices until the user explicitly re-opens it
  // (which clears the flag in `recordRecent`).
  pinnedAt: timestamp("pinned_at"),
  hidden: boolean("hidden").notNull().default(false),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  userOpenedIdx: index("takeoff_recents_user_opened_idx").on(table.userId, table.openedAt),
  uniqueEntry: unique("takeoff_recents_user_entry_unique").on(
    table.userId,
    table.kind,
    table.entityId,
    table.sheetId,
  ),
}));

export const insertTakeoffRecentSchema = createInsertSchema(takeoffRecents).omit({ id: true, updatedAt: true });
export type InsertTakeoffRecent = z.infer<typeof insertTakeoffRecentSchema>;
export type TakeoffRecent = typeof takeoffRecents.$inferSelect;

// ==================================================
// Task #2403 + #2404 — Standalone Takeoff Tool
// ==================================================
// Phase 1: anyone can open Takeoff and start measuring without first
// creating a bid or project. Phase 2: same takeoff can be tagged to many
// bids/projects, suggested when a new bid/project is created, and pushed
// into an estimate as line items.

export const standaloneTakeoffs = pgTable("standalone_takeoffs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  ownerUserId: varchar("owner_user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  tradeType: tradeTypeEnum("trade_type"),
  // Free-form context the ranker uses (client name, address, notes).
  clientName: text("client_name"),
  locationAddress: text("location_address"),
  notes: text("notes"),
  settings: text("settings").notNull().default("{}"),
  archivedAt: timestamp("archived_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  orgIdx: index("standalone_takeoffs_org_idx").on(table.organizationId),
  ownerIdx: index("standalone_takeoffs_owner_idx").on(table.ownerUserId, table.updatedAt),
}));

// Multi-link tagging: same standalone takeoff can be tagged to many bids
// and many projects simultaneously. Exactly-one-of-(bidId, projectId) is
// enforced via a CHECK constraint installed at startup.
export const takeoffTags = pgTable("takeoff_tags", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  standaloneTakeoffId: varchar("standalone_takeoff_id").notNull().references(() => standaloneTakeoffs.id, { onDelete: "cascade" }),
  bidId: varchar("bid_id").references(() => bids.id, { onDelete: "cascade" }),
  projectId: varchar("project_id").references(() => projects.id, { onDelete: "cascade" }),
  taggedById: varchar("tagged_by_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  takeoffIdx: index("takeoff_tags_takeoff_idx").on(table.standaloneTakeoffId),
  bidIdx: index("takeoff_tags_bid_idx").on(table.bidId),
  projectIdx: index("takeoff_tags_project_idx").on(table.projectId),
  uniqBid: uniqueIndex("takeoff_tags_takeoff_bid_unique").on(table.standaloneTakeoffId, table.bidId).where(sql`${table.bidId} IS NOT NULL`),
  uniqProj: uniqueIndex("takeoff_tags_takeoff_project_unique").on(table.standaloneTakeoffId, table.projectId).where(sql`${table.projectId} IS NOT NULL`),
}));

// Per-takeoff private files (PDFs/docs uploaded into the standalone
// workspace before any bid/project is in scope).
export const standaloneTakeoffFiles = pgTable("standalone_takeoff_files", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  standaloneTakeoffId: varchar("standalone_takeoff_id").notNull().references(() => standaloneTakeoffs.id, { onDelete: "cascade" }),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  uploadedById: varchar("uploaded_by_id").references(() => users.id, { onDelete: "set null" }),
  fileName: text("file_name").notNull(),
  fileUrl: text("file_url").notNull(),
  objectKey: text("object_key"),
  mimeType: text("mime_type"),
  fileSize: integer("file_size"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  takeoffIdx: index("standalone_takeoff_files_takeoff_idx").on(table.standaloneTakeoffId),
}));

// Per-user dismissals of "Suggested takeoffs" entries on a bid/project
// home. Keyed on (userId, standaloneTakeoffId, destinationKind, destinationId).
export const takeoffSuggestionDismissals = pgTable("takeoff_suggestion_dismissals", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  standaloneTakeoffId: varchar("standalone_takeoff_id").notNull().references(() => standaloneTakeoffs.id, { onDelete: "cascade" }),
  destinationKind: text("destination_kind").notNull(), // "bid" | "project"
  destinationId: varchar("destination_id").notNull(),
  // Task #2404 — also captures accept events as a training signal so
  // the ranker can learn which suggestions actually got attached.
  outcome: text("outcome").notNull().default("DISMISSED"), // "DISMISSED" | "ACCEPTED"
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  userDestIdx: index("takeoff_suggestion_dismissals_user_dest_idx").on(table.userId, table.destinationKind, table.destinationId),
  uniq: uniqueIndex("takeoff_suggestion_dismissals_unique").on(table.userId, table.standaloneTakeoffId, table.destinationKind, table.destinationId),
}));

export const insertStandaloneTakeoffSchema = createInsertSchema(standaloneTakeoffs).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertStandaloneTakeoff = z.infer<typeof insertStandaloneTakeoffSchema>;
export type StandaloneTakeoff = typeof standaloneTakeoffs.$inferSelect;

export const insertTakeoffTagSchema = createInsertSchema(takeoffTags).omit({ id: true, createdAt: true });
export type InsertTakeoffTag = z.infer<typeof insertTakeoffTagSchema>;
export type TakeoffTag = typeof takeoffTags.$inferSelect;

export const insertStandaloneTakeoffFileSchema = createInsertSchema(standaloneTakeoffFiles).omit({ id: true, createdAt: true });
export type InsertStandaloneTakeoffFile = z.infer<typeof insertStandaloneTakeoffFileSchema>;
export type StandaloneTakeoffFile = typeof standaloneTakeoffFiles.$inferSelect;

export const insertTakeoffSuggestionDismissalSchema = createInsertSchema(takeoffSuggestionDismissals).omit({ id: true, createdAt: true });
export type InsertTakeoffSuggestionDismissal = z.infer<typeof insertTakeoffSuggestionDismissalSchema>;
export type TakeoffSuggestionDismissal = typeof takeoffSuggestionDismissals.$inferSelect;