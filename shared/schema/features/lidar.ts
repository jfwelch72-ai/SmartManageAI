// AUTO-GENERATED SPLIT FROM shared/schema/features.ts (Task #2426).
// Domain bucketing rule lives in shared/schema/features/index.ts.
import { sql } from "drizzle-orm";
import { pgTable, text, varchar, boolean, timestamp, date, decimal, integer, pgEnum, doublePrecision, index, unique, uniqueIndex, json, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod";
import { addendumRecipientTypeEnum, addendumStatusEnum, aiBidDocumentAnalysisStatusEnum, aiCoDraftStatusEnum, aiContractDocumentAnalysisStatusEnum, contractStatusEnum, contractTypeEnum, contractRedlineStatusEnum, contractApprovalDecisionEnum, clauseCategoryEnum, signatureRequestStatusEnum, signerStatusEnum, aiInsightModuleEnum, aiInsightSeverityEnum, aiTakeoffModeEnum, aiTakeoffStatusEnum, aiTakeoffSuggestionStatusEnum, aiTakeoffRejectReasonEnum, aiTaskPriorityEnum, aiTaskStatusEnum, approvalEntityTypeEnum, approvalStatusEnum, atsProviderEnum, bidEquipmentSourceEnum, bidInvitationStatusEnum, bidRequestStatusEnum, bidResponseStatusEnum, blogCommentStatusEnum, blogPostStatusEnum, conversationTypeEnum, crewAvailabilityStatusEnum, crmActivityTypeEnum, crmCallDirectionEnum, crmCallOutcomeEnum, crmCallStatusEnum, crmCustomFieldEntityEnum, crmCustomFieldTypeEnum, crmContactRoleEnum, crmNoteTypeEnum, crmOrgStatusEnum, crmOrganisationTypeEnum, crmPipelineStageEnum, crmPreferredContactEnum, crmLostCategoryEnum, crmQuoteAcceptanceStatusEnum, crmLeadScoringOperatorEnum, crmSequenceStatusEnum, crmSequenceStepTypeEnum, crmSequenceEnrollmentStatusEnum, crmSequenceExecutionStatusEnum, crmSequenceEmailEventTypeEnum, crmSequenceExitReasonEnum, crmQuoteApprovalStatusEnum, dataSubjectRequestStatusEnum, dataSubjectRequestTypeEnum, documentRevisionSourceEnum, documentRevisionStatusEnum, emailClassificationEnum, emailProviderEnum, emailTaskSourceEnum, emailThreadStatusEnum, hiringActivityTypeEnum, hiringCandidateStageEnum, hiringCompensationTypeEnum, hiringEmploymentTypeEnum, hiringInterviewStatusEnum, hiringJobStatusEnum, hiringSyncStatusEnum, hustlerDelegateRoleEnum, hustlerLinkRequestStatusEnum, installationStatusEnum, lidarScanStatusEnum, lidarAnnotationTypeEnum, lidarComparisonTypeEnum, unifiedPaymentMethodEnum, unifiedPaymentStatusEnum, invoiceTypeEnum, integrationConnectionStatusEnum, integrationEventStatusEnum, integrationProviderEnum, issueSeverityEnum, issueStatusEnum, jobsiteAnalysisStatusEnum, lienWaiverStatusEnum, lienWaiverTypeEnum, locationLevelEnum, maintenanceTypeEnum, measurementReviewStatusEnum, measurementSourceEnum, measurementStatusEnum, measurementTypeEnum, takeoffVersionStatusEnum, messageEntityTypeEnum, mobilePlatformEnum, offlineEntityTypeEnum, offlineOperationTypeEnum, offlineSyncStatusEnum, organizationDocumentTypeEnum, organizationDocumentVisibilityEnum, overheadCostActionEnum, overheadCostCategoryEnum, overheadCostFrequencyEnum, portalChatPriorityEnum, portalChatThreadCategoryEnum, portalChatThreadStatusEnum, pricebookImportJobStatusEnum, pricebookStatusEnum, pricingApprovalStatusEnum, pricingSourceTypeEnum, projectEquipmentPlanStatusEnum, repairStatusEnum, retentionActionEnum, retentionEntityTypeEnum, rewardTypeEnum, rfiCategoryEnum, rfiPriorityEnum, rfiStatusEnum, scheduleDependencyTypeEnum, scheduleGeneratedByEnum, scheduleTaskStatusEnum, socialAccountStatusEnum, socialPlatformEnum, socialPostStatusEnum, sovPaymentMethodEnum, sovStatusEnum, storedMaterialStatusEnum, retentionReleaseTypeEnum, retentionReleaseStatusEnum, sowAuditActionEnum, ssoProviderEnum, submittalCategoryEnum, submittalItemStatusEnum, submittalPhaseEnum, submittalReviewRoleEnum, submittalReviewStatusEnum, submittalStatusEnum, submittalTypeEnum, syncStatusEnum, tradeTypeEnum, transmittalStatusEnum, userRoleEnum, vendorEnrollmentStatusEnum, voiceLogStatusEnum, websiteDeploymentActionEnum, websitePageTypeEnum, websiteProjectStatusEnum, websiteStatusEnum, takeoffIssueCategoryEnum, takeoffIssueStatusEnum, talentAvailabilityEnum, talentProfileVisibilityEnum, workflowEntityTypeEnum, riskCategoryEnum, riskStatusEnum, workflowTemplateStatusEnum, workflowInstanceStatusEnum, videoCallStatusEnum, workflowNotificationChannelEnum, dotAgencyKindEnum, dotPayItemTypeEnum, dbeCertificationTypeEnum, suretyBondTypeEnum, suretyBondStatusEnum, haulTicketStatusEnum, swpppInspectionTypeEnum, idrStatusEnum, buyAmericaStatusEnum } from "../enums";
import { bids, organizations, projects, users } from "../core";
import { changeOrders, estimateLineItems, estimates, planDocuments, projectInspections, tasks, tmTickets } from "../operations";



export const lidarScans = pgTable("lidar_scans", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  uploadedById: varchar("uploaded_by_id").references(() => users.id, { onDelete: "set null" }),
  fileName: text("file_name").notNull(),
  fileUrl: text("file_url").notNull(),
  fileSize: integer("file_size"),
  fileFormat: text("file_format"),
  status: lidarScanStatusEnum("status").notNull().default("UPLOADING"),
  captureDate: timestamp("capture_date"),
  captureDevice: text("capture_device"),
  location: text("location"),
  notes: text("notes"),
  pointCount: integer("point_count"),
  thumbnailUrl: text("thumbnail_url"),
  metadata: text("metadata"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  projectIdx: index("lidar_scans_project_idx").on(table.projectId),
  orgIdx: index("lidar_scans_org_idx").on(table.organizationId),
  statusIdx: index("lidar_scans_status_idx").on(table.status),
  captureDateIdx: index("lidar_scans_capture_date_idx").on(table.captureDate),
}));

export const insertLidarScanSchema = createInsertSchema(lidarScans).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertLidarScan = z.infer<typeof insertLidarScanSchema>;
export type LidarScan = typeof lidarScans.$inferSelect;

export const lidarAnnotations = pgTable("lidar_annotations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  scanId: varchar("scan_id").notNull().references(() => lidarScans.id, { onDelete: "cascade" }),
  createdById: varchar("created_by_id").references(() => users.id, { onDelete: "set null" }),
  type: lidarAnnotationTypeEnum("type").notNull(),
  label: text("label").notNull(),
  points: text("points").notNull(),
  value: doublePrecision("value"),
  unit: text("unit"),
  note: text("note"),
  color: text("color").default("#ff0000"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  scanIdx: index("lidar_annotations_scan_idx").on(table.scanId),
  typeIdx: index("lidar_annotations_type_idx").on(table.type),
}));

export const insertLidarAnnotationSchema = createInsertSchema(lidarAnnotations).omit({ id: true, createdAt: true });
export type InsertLidarAnnotation = z.infer<typeof insertLidarAnnotationSchema>;
export type LidarAnnotation = typeof lidarAnnotations.$inferSelect;

export const lidarComparisons = pgTable("lidar_comparisons", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  createdById: varchar("created_by_id").references(() => users.id, { onDelete: "set null" }),
  type: lidarComparisonTypeEnum("type").notNull(),
  name: text("name").notNull(),
  scanAId: varchar("scan_a_id").notNull().references(() => lidarScans.id, { onDelete: "cascade" }),
  scanBId: varchar("scan_b_id").references(() => lidarScans.id, { onDelete: "cascade" }),
  bimDocumentId: varchar("bim_document_id"),
  bimDocumentUrl: text("bim_document_url"),
  toleranceMm: doublePrecision("tolerance_mm").default(25),
  deviationData: text("deviation_data"),
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  projectIdx: index("lidar_comparisons_project_idx").on(table.projectId),
  orgIdx: index("lidar_comparisons_org_idx").on(table.organizationId),
  scanAIdx: index("lidar_comparisons_scan_a_idx").on(table.scanAId),
}));

export const insertLidarComparisonSchema = createInsertSchema(lidarComparisons).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertLidarComparison = z.infer<typeof insertLidarComparisonSchema>;
export type LidarComparison = typeof lidarComparisons.$inferSelect;