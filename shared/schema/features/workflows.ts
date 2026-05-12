// AUTO-GENERATED SPLIT FROM shared/schema/features.ts (Task #2426).
// Domain bucketing rule lives in shared/schema/features/index.ts.
import { sql } from "drizzle-orm";
import { pgTable, text, varchar, boolean, timestamp, date, decimal, integer, pgEnum, doublePrecision, index, unique, uniqueIndex, json, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod";
import { addendumRecipientTypeEnum, addendumStatusEnum, aiBidDocumentAnalysisStatusEnum, aiCoDraftStatusEnum, aiContractDocumentAnalysisStatusEnum, contractStatusEnum, contractTypeEnum, contractRedlineStatusEnum, contractApprovalDecisionEnum, clauseCategoryEnum, signatureRequestStatusEnum, signerStatusEnum, aiInsightModuleEnum, aiInsightSeverityEnum, aiTakeoffModeEnum, aiTakeoffStatusEnum, aiTakeoffSuggestionStatusEnum, aiTakeoffRejectReasonEnum, aiTaskPriorityEnum, aiTaskStatusEnum, approvalEntityTypeEnum, approvalStatusEnum, atsProviderEnum, bidEquipmentSourceEnum, bidInvitationStatusEnum, bidRequestStatusEnum, bidResponseStatusEnum, blogCommentStatusEnum, blogPostStatusEnum, conversationTypeEnum, crewAvailabilityStatusEnum, crmActivityTypeEnum, crmCallDirectionEnum, crmCallOutcomeEnum, crmCallStatusEnum, crmCustomFieldEntityEnum, crmCustomFieldTypeEnum, crmContactRoleEnum, crmNoteTypeEnum, crmOrgStatusEnum, crmOrganisationTypeEnum, crmPipelineStageEnum, crmPreferredContactEnum, crmLostCategoryEnum, crmQuoteAcceptanceStatusEnum, crmLeadScoringOperatorEnum, crmSequenceStatusEnum, crmSequenceStepTypeEnum, crmSequenceEnrollmentStatusEnum, crmSequenceExecutionStatusEnum, crmSequenceEmailEventTypeEnum, crmSequenceExitReasonEnum, crmQuoteApprovalStatusEnum, dataSubjectRequestStatusEnum, dataSubjectRequestTypeEnum, documentRevisionSourceEnum, documentRevisionStatusEnum, emailClassificationEnum, emailProviderEnum, emailTaskSourceEnum, emailThreadStatusEnum, hiringActivityTypeEnum, hiringCandidateStageEnum, hiringCompensationTypeEnum, hiringEmploymentTypeEnum, hiringInterviewStatusEnum, hiringJobStatusEnum, hiringSyncStatusEnum, hustlerDelegateRoleEnum, hustlerLinkRequestStatusEnum, installationStatusEnum, lidarScanStatusEnum, lidarAnnotationTypeEnum, lidarComparisonTypeEnum, unifiedPaymentMethodEnum, unifiedPaymentStatusEnum, invoiceTypeEnum, integrationConnectionStatusEnum, integrationEventStatusEnum, integrationProviderEnum, issueSeverityEnum, issueStatusEnum, jobsiteAnalysisStatusEnum, lienWaiverStatusEnum, lienWaiverTypeEnum, locationLevelEnum, maintenanceTypeEnum, measurementReviewStatusEnum, measurementSourceEnum, measurementStatusEnum, measurementTypeEnum, takeoffVersionStatusEnum, messageEntityTypeEnum, mobilePlatformEnum, offlineEntityTypeEnum, offlineOperationTypeEnum, offlineSyncStatusEnum, organizationDocumentTypeEnum, organizationDocumentVisibilityEnum, overheadCostActionEnum, overheadCostCategoryEnum, overheadCostFrequencyEnum, portalChatPriorityEnum, portalChatThreadCategoryEnum, portalChatThreadStatusEnum, pricebookImportJobStatusEnum, pricebookStatusEnum, pricingApprovalStatusEnum, pricingSourceTypeEnum, projectEquipmentPlanStatusEnum, repairStatusEnum, retentionActionEnum, retentionEntityTypeEnum, rewardTypeEnum, rfiCategoryEnum, rfiPriorityEnum, rfiStatusEnum, scheduleDependencyTypeEnum, scheduleGeneratedByEnum, scheduleTaskStatusEnum, socialAccountStatusEnum, socialPlatformEnum, socialPostStatusEnum, sovPaymentMethodEnum, sovStatusEnum, storedMaterialStatusEnum, retentionReleaseTypeEnum, retentionReleaseStatusEnum, sowAuditActionEnum, ssoProviderEnum, submittalCategoryEnum, submittalItemStatusEnum, submittalPhaseEnum, submittalReviewRoleEnum, submittalReviewStatusEnum, submittalStatusEnum, submittalTypeEnum, syncStatusEnum, tradeTypeEnum, transmittalStatusEnum, userRoleEnum, vendorEnrollmentStatusEnum, voiceLogStatusEnum, websiteDeploymentActionEnum, websitePageTypeEnum, websiteProjectStatusEnum, websiteStatusEnum, takeoffIssueCategoryEnum, takeoffIssueStatusEnum, talentAvailabilityEnum, talentProfileVisibilityEnum, workflowEntityTypeEnum, riskCategoryEnum, riskStatusEnum, workflowTemplateStatusEnum, workflowInstanceStatusEnum, videoCallStatusEnum, workflowNotificationChannelEnum, dotAgencyKindEnum, dotPayItemTypeEnum, dbeCertificationTypeEnum, suretyBondTypeEnum, suretyBondStatusEnum, haulTicketStatusEnum, swpppInspectionTypeEnum, idrStatusEnum, buyAmericaStatusEnum } from "../enums";
import { bids, organizations, projects, users } from "../core";
import { changeOrders, estimateLineItems, estimates, planDocuments, projectInspections, tasks, tmTickets } from "../operations";



export const workflowTemplates = pgTable("workflow_templates", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description"),
  entityType: workflowEntityTypeEnum("entity_type").notNull(),
  status: workflowTemplateStatusEnum("status").notNull().default("DRAFT"),
  isDefault: boolean("is_default").notNull().default(false),
  createdById: varchar("created_by_id").notNull().references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  orgIdx: index("workflow_templates_org_idx").on(table.organizationId),
  entityTypeIdx: index("workflow_templates_entity_type_idx").on(table.entityType),
  statusIdx: index("workflow_templates_status_idx").on(table.status),
}));

export const insertWorkflowTemplateSchema = createInsertSchema(workflowTemplates).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertWorkflowTemplate = z.infer<typeof insertWorkflowTemplateSchema>;
export type WorkflowTemplate = typeof workflowTemplates.$inferSelect;

export const workflowStages = pgTable("workflow_stages", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  templateId: varchar("template_id").notNull().references(() => workflowTemplates.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description"),
  stageOrder: integer("stage_order").notNull(),
  color: text("color").default("#6366f1"),
  allowedTransitions: json("allowed_transitions").$type<string[]>().default([]),
  isInitial: boolean("is_initial").notNull().default(false),
  isFinal: boolean("is_final").notNull().default(false),
  slaDurationHours: integer("sla_duration_hours"),
  autoEscalateRole: text("auto_escalate_role"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  templateIdx: index("workflow_stages_template_idx").on(table.templateId),
  orderIdx: index("workflow_stages_order_idx").on(table.templateId, table.stageOrder),
}));

export const insertWorkflowStageSchema = createInsertSchema(workflowStages).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertWorkflowStage = z.infer<typeof insertWorkflowStageSchema>;
export type WorkflowStage = typeof workflowStages.$inferSelect;

export const workflowApprovalSteps = pgTable("workflow_approval_steps", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  stageId: varchar("stage_id").notNull().references(() => workflowStages.id, { onDelete: "cascade" }),
  requiredRole: text("required_role"),
  requiredUserId: varchar("required_user_id").references(() => users.id, { onDelete: "set null" }),
  requiredApprovalCount: integer("required_approval_count").notNull().default(1),
  stepOrder: integer("step_order").notNull().default(1),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  stageIdx: index("workflow_approval_steps_stage_idx").on(table.stageId),
}));

export const insertWorkflowApprovalStepSchema = createInsertSchema(workflowApprovalSteps).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertWorkflowApprovalStep = z.infer<typeof insertWorkflowApprovalStepSchema>;
export type WorkflowApprovalStep = typeof workflowApprovalSteps.$inferSelect;

export const workflowNotificationRules = pgTable("workflow_notification_rules", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  stageId: varchar("stage_id").notNull().references(() => workflowStages.id, { onDelete: "cascade" }),
  triggerOnEnter: boolean("trigger_on_enter").notNull().default(true),
  triggerOnExit: boolean("trigger_on_exit").notNull().default(false),
  channel: workflowNotificationChannelEnum("channel").notNull().default("EMAIL"),
  recipientRole: text("recipient_role"),
  recipientUserId: varchar("recipient_user_id").references(() => users.id, { onDelete: "set null" }),
  notifySubmitter: boolean("notify_submitter").notNull().default(false),
  messageTemplate: text("message_template"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  stageIdx: index("workflow_notification_rules_stage_idx").on(table.stageId),
}));

export const insertWorkflowNotificationRuleSchema = createInsertSchema(workflowNotificationRules).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertWorkflowNotificationRule = z.infer<typeof insertWorkflowNotificationRuleSchema>;
export type WorkflowNotificationRule = typeof workflowNotificationRules.$inferSelect;

export const workflowInstances = pgTable("workflow_instances", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  templateId: varchar("template_id").notNull().references(() => workflowTemplates.id, { onDelete: "cascade" }),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  entityType: workflowEntityTypeEnum("entity_type").notNull(),
  entityId: varchar("entity_id").notNull(),
  currentStageId: varchar("current_stage_id").references(() => workflowStages.id, { onDelete: "set null" }),
  status: workflowInstanceStatusEnum("status").notNull().default("IN_PROGRESS"),
  startedAt: timestamp("started_at").notNull().defaultNow(),
  completedAt: timestamp("completed_at"),
  startedByUserId: varchar("started_by_user_id").references(() => users.id),
  pendingApprovals: json("pending_approvals").$type<Array<{
    stageId: string;
    stepId: string;
    userId: string;
    approvedAt: string;
  }>>().default([]),
  history: json("history").$type<Array<{
    fromStageId: string | null;
    toStageId: string;
    fromStageName: string | null;
    toStageName: string;
    transitionedAt: string;
    transitionedByUserId: string | null;
    notes: string | null;
  }>>().default([]),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  templateIdx: index("workflow_instances_template_idx").on(table.templateId),
  orgIdx: index("workflow_instances_org_idx").on(table.organizationId),
  entityIdx: index("workflow_instances_entity_idx").on(table.entityType, table.entityId),
  statusIdx: index("workflow_instances_status_idx").on(table.status),
}));

export const insertWorkflowInstanceSchema = createInsertSchema(workflowInstances).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertWorkflowInstance = z.infer<typeof insertWorkflowInstanceSchema>;
export type WorkflowInstance = typeof workflowInstances.$inferSelect;

export const globalWorkflowTemplates = pgTable("global_workflow_templates", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  entityType: varchar("entity_type", { length: 50 }).notNull(),
  isPublished: boolean("is_published").default(false).notNull(),
  templateData: json("template_data").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  createdById: text("created_by_id").references(() => users.id),
}, (table) => ({
  publishedIdx: index("global_workflow_templates_published_idx").on(table.isPublished),
}));

export const insertGlobalWorkflowTemplateSchema = createInsertSchema(globalWorkflowTemplates).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertGlobalWorkflowTemplate = z.infer<typeof insertGlobalWorkflowTemplateSchema>;
export type GlobalWorkflowTemplate = typeof globalWorkflowTemplates.$inferSelect;