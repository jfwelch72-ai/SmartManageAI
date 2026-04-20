import { sql } from "drizzle-orm";
import { pgTable, text, varchar, boolean, timestamp, date, decimal, integer, pgEnum, doublePrecision, index, unique, uniqueIndex, json, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod";
import { addendumRecipientTypeEnum, addendumStatusEnum, aiBidDocumentAnalysisStatusEnum, aiCoDraftStatusEnum, aiContractDocumentAnalysisStatusEnum, contractStatusEnum, contractTypeEnum, contractRedlineStatusEnum, contractApprovalDecisionEnum, clauseCategoryEnum, signatureRequestStatusEnum, signerStatusEnum, aiInsightModuleEnum, aiInsightSeverityEnum, aiTakeoffModeEnum, aiTakeoffStatusEnum, aiTaskPriorityEnum, aiTaskStatusEnum, approvalEntityTypeEnum, approvalStatusEnum, atsProviderEnum, bidEquipmentSourceEnum, bidInvitationStatusEnum, bidRequestStatusEnum, bidResponseStatusEnum, blogCommentStatusEnum, blogPostStatusEnum, conversationTypeEnum, crewAvailabilityStatusEnum, crmActivityTypeEnum, crmCustomFieldEntityEnum, crmCustomFieldTypeEnum, crmContactRoleEnum, crmNoteTypeEnum, crmOrgStatusEnum, crmOrganisationTypeEnum, crmPipelineStageEnum, crmPreferredContactEnum, crmLostCategoryEnum, crmQuoteAcceptanceStatusEnum, crmLeadScoringOperatorEnum, crmSequenceStatusEnum, crmSequenceStepTypeEnum, crmSequenceEnrollmentStatusEnum, crmSequenceExecutionStatusEnum, crmSequenceEmailEventTypeEnum, crmSequenceExitReasonEnum, dataSubjectRequestStatusEnum, dataSubjectRequestTypeEnum, documentRevisionSourceEnum, documentRevisionStatusEnum, emailClassificationEnum, emailProviderEnum, emailTaskSourceEnum, emailThreadStatusEnum, hiringActivityTypeEnum, hiringCandidateStageEnum, hiringCompensationTypeEnum, hiringEmploymentTypeEnum, hiringInterviewStatusEnum, hiringJobStatusEnum, hiringSyncStatusEnum, hustlerDelegateRoleEnum, hustlerLinkRequestStatusEnum, installationStatusEnum, lidarScanStatusEnum, lidarAnnotationTypeEnum, lidarComparisonTypeEnum, unifiedPaymentMethodEnum, unifiedPaymentStatusEnum, invoiceTypeEnum, integrationConnectionStatusEnum, integrationEventStatusEnum, integrationProviderEnum, issueSeverityEnum, issueStatusEnum, jobsiteAnalysisStatusEnum, lienWaiverStatusEnum, lienWaiverTypeEnum, locationLevelEnum, maintenanceTypeEnum, measurementSourceEnum, measurementStatusEnum, measurementTypeEnum, takeoffVersionStatusEnum, messageEntityTypeEnum, mobilePlatformEnum, offlineEntityTypeEnum, offlineOperationTypeEnum, offlineSyncStatusEnum, organizationDocumentTypeEnum, organizationDocumentVisibilityEnum, overheadCostActionEnum, overheadCostCategoryEnum, overheadCostFrequencyEnum, portalChatPriorityEnum, portalChatThreadCategoryEnum, portalChatThreadStatusEnum, pricebookImportJobStatusEnum, pricebookStatusEnum, pricingApprovalStatusEnum, pricingSourceTypeEnum, projectEquipmentPlanStatusEnum, repairStatusEnum, retentionActionEnum, retentionEntityTypeEnum, rewardTypeEnum, rfiCategoryEnum, rfiPriorityEnum, rfiStatusEnum, scheduleGeneratedByEnum, scheduleTaskStatusEnum, socialAccountStatusEnum, socialPlatformEnum, socialPostStatusEnum, sovPaymentMethodEnum, sovStatusEnum, storedMaterialStatusEnum, retentionReleaseTypeEnum, retentionReleaseStatusEnum, sowAuditActionEnum, ssoProviderEnum, submittalCategoryEnum, submittalItemStatusEnum, submittalPhaseEnum, submittalReviewRoleEnum, submittalReviewStatusEnum, submittalStatusEnum, submittalTypeEnum, syncStatusEnum, tradeTypeEnum, transmittalStatusEnum, userRoleEnum, vendorEnrollmentStatusEnum, voiceLogStatusEnum, websiteDeploymentActionEnum, websitePageTypeEnum, websiteProjectStatusEnum, websiteStatusEnum, takeoffIssueCategoryEnum, takeoffIssueStatusEnum, talentAvailabilityEnum, talentProfileVisibilityEnum, workflowEntityTypeEnum, riskCategoryEnum, riskStatusEnum, workflowTemplateStatusEnum, workflowInstanceStatusEnum, videoCallStatusEnum, workflowNotificationChannelEnum, dotAgencyKindEnum, dotPayItemTypeEnum, dbeCertificationTypeEnum, suretyBondTypeEnum, suretyBondStatusEnum, haulTicketStatusEnum, swpppInspectionTypeEnum, idrStatusEnum, buyAmericaStatusEnum } from "./enums";
import { bids, organizations, projects, users } from "./core";
import { changeOrders, estimateLineItems, estimates, planDocuments, projectInspections, tasks, tmTickets } from "./operations";

export const FEATURE_FLAG_KEYS = [
  "INTEGRATIONS_HUB",
  "INTEGRATION_QBO",
  "INTEGRATION_GOOGLE",
  "INTEGRATION_MICROSOFT",
  "INTEGRATION_ESIGN",
  "SSO",
  "AUDIT_EXPORT",
  "DATA_RETENTION",
  "PRIVACY_COMPLIANCE",
  "SESSION_MANAGEMENT",
  "INTEGRATION_ZAPIER",
  "AI_GOVERNANCE",
  "APPROVALS_FRAMEWORK",
  "DOCUMENT_CONTROL",
  "EXECUTIVE_DIGEST",
  "PROJECT_HEALTH_SCORE",
  "MOBILE_OFFLINE_V2",
  "HIRING_MODULE",
  "HIRING_AI_SCORING",
  "HIRING_AUTO_TASKS",
  "HIRING_ATS_SYNC",
  "BIM_VIEWER",
  "REVENUE_RECOGNITION",
  "WHATIF_SIMULATOR",
  "LIDAR_SCANNER",
  "VIDEO_CALLS",
  "SMS_NOTIFICATIONS",
  // Heavy Civil / DOT
  "DOT_PAY_ITEMS",
  "DBE_TRACKING",
  "WH_347_PAYROLL",
  "HAUL_TICKETS",
  "DAILY_INSPECTOR_REPORTS",
  "SWPPP_INSPECTIONS",
  "SURETY_BONDS",
  "BUY_AMERICA",
  "MASS_HAUL_ANALYZER",
  "DOT_PROGRESS_ESTIMATE",
  "HEAVY_CIVIL_PRESET",
] as const;

export type FeatureFlagKey = (typeof FEATURE_FLAG_KEYS)[number];

export const FEATURE_FLAG_LABELS: Record<FeatureFlagKey, string> = {
  INTEGRATIONS_HUB: "Integrations Hub",
  INTEGRATION_QBO: "QuickBooks Online",
  INTEGRATION_GOOGLE: "Google Workspace",
  INTEGRATION_MICROSOFT: "Microsoft 365",
  INTEGRATION_ESIGN: "E-Signature (DocuSign)",
  INTEGRATION_ZAPIER: "Zapier",
  SSO: "Single Sign-On (SAML)",
  AUDIT_EXPORT: "Audit Log Export",
  DATA_RETENTION: "Data Retention Policies",
  PRIVACY_COMPLIANCE: "GDPR / Privacy Tools",
  SESSION_MANAGEMENT: "Advanced Session Security",
  AI_GOVERNANCE: "AI Governance",
  APPROVALS_FRAMEWORK: "Approvals Framework",
  DOCUMENT_CONTROL: "Document Control",
  EXECUTIVE_DIGEST: "Executive Digest",
  PROJECT_HEALTH_SCORE: "Project Health Score",
  MOBILE_OFFLINE_V2: "Mobile & Offline Sync",
  HIRING_MODULE: "Hiring Module",
  HIRING_AI_SCORING: "Hiring – AI Candidate Scoring",
  HIRING_AUTO_TASKS: "Hiring – Automated Tasks",
  HIRING_ATS_SYNC: "Hiring – ATS Sync",
  BIM_VIEWER: "3D BIM Viewer",
  REVENUE_RECOGNITION: "Revenue Recognition / WIP",
  WHATIF_SIMULATOR: "What-If Simulator",
  LIDAR_SCANNER: "LiDAR Scanner",
  VIDEO_CALLS: "Video Calls",
  SMS_NOTIFICATIONS: "SMS Notifications",
  DOT_PAY_ITEMS: "DOT Pay Items Library",
  DBE_TRACKING: "DBE / MBE / WBE Tracking",
  WH_347_PAYROLL: "WH-347 Certified Payroll",
  HAUL_TICKETS: "Haul Tickets",
  DAILY_INSPECTOR_REPORTS: "Daily Inspector Reports (IDR)",
  SWPPP_INSPECTIONS: "SWPPP Inspections",
  SURETY_BONDS: "Surety Bonds",
  BUY_AMERICA: "Buy America Compliance",
  MASS_HAUL_ANALYZER: "Mass Haul Analyzer",
  DOT_PROGRESS_ESTIMATE: "DOT Progress Estimate",
  HEAVY_CIVIL_PRESET: "Heavy Civil Preset",
};

export const FEATURE_FLAG_DESCRIPTIONS: Record<FeatureFlagKey, string> = {
  INTEGRATIONS_HUB: "Central place to connect and monitor third-party services.",
  INTEGRATION_QBO: "Two-way sync of customers, invoices, bills, and payments with QuickBooks Online.",
  INTEGRATION_GOOGLE: "Connect Gmail and Google Calendar for messaging, scheduling, and email-to-task.",
  INTEGRATION_MICROSOFT: "Connect Outlook Mail and Calendar for messaging, scheduling, and email-to-task.",
  INTEGRATION_ESIGN: "Send contracts, change orders, and lien waivers through DocuSign for signature.",
  INTEGRATION_ZAPIER: "Trigger Zapier automations from project, bid, and CRM events.",
  SSO: "Let your team sign in with your corporate SAML identity provider (Okta, Azure AD, Google).",
  AUDIT_EXPORT: "Export the full audit log to CSV or JSON for compliance reviews.",
  DATA_RETENTION: "Define how long to keep records before automatic archival or deletion.",
  PRIVACY_COMPLIANCE: "GDPR and CCPA tooling for data subject requests and consent.",
  SESSION_MANAGEMENT: "Forced re-auth, session timeout, and per-device session control.",
  AI_GOVERNANCE: "Per-org AI usage caps, action gating, and audit of every AI call.",
  APPROVALS_FRAMEWORK: "Configurable approval chains for change orders, POs, payables, and more.",
  DOCUMENT_CONTROL: "Versioned document storage with expiration tracking and revision history.",
  EXECUTIVE_DIGEST: "Weekly executive email summarizing pipeline, cash, and project health.",
  PROJECT_HEALTH_SCORE: "Deterministic 0–100 health score per project with drivers.",
  MOBILE_OFFLINE_V2: "Field PWA with offline data capture, sync queue, and conflict resolution.",
  HIRING_MODULE: "Job postings, candidate pipeline, interviews, and hires.",
  HIRING_AI_SCORING: "AI-assisted resume scoring and ranking against job requirements.",
  HIRING_AUTO_TASKS: "Automatic onboarding and interview tasks when candidates change stage.",
  HIRING_ATS_SYNC: "Sync jobs and candidates with external ATS providers.",
  BIM_VIEWER: "Open IFC models in the browser and pull quantities into estimates.",
  REVENUE_RECOGNITION: "Percent-complete revenue recognition and WIP reporting.",
  WHATIF_SIMULATOR: "Run cost, schedule, and crew what-if scenarios on live projects.",
  LIDAR_SCANNER: "Upload LAS/LAZ point clouds for as-built comparison and quantity takeoffs.",
  VIDEO_CALLS: "In-app video calling for messaging, client portal, and field support.",
  SMS_NOTIFICATIONS: "Send notifications and reminders by SMS in addition to email and push.",
  DOT_PAY_ITEMS: "Browse FHWA and state DOT pay item catalogs and tie them to bid and SOV lines.",
  DBE_TRACKING: "Track DBE/MBE/WBE/SBE goals, commitments, and certifications by project.",
  WH_347_PAYROLL: "Generate weekly federal WH-347 certified payroll reports for prevailing-wage jobs.",
  HAUL_TICKETS: "Capture truck haul tickets in the field and reconcile planned vs. actual quantities.",
  DAILY_INSPECTOR_REPORTS: "DOT-style daily inspector report (IDR) — one per project per day.",
  SWPPP_INSPECTIONS: "Stormwater (SWPPP) inspections with routine, post-rain, and final cadence.",
  SURETY_BONDS: "Track bid, performance, payment, and maintenance bonds with expirations.",
  BUY_AMERICA: "Capture Buy America material certifications and waiver requests.",
  MASS_HAUL_ANALYZER: "Cut/fill balance and mass-haul diagrams for earthwork projects.",
  DOT_PROGRESS_ESTIMATE: "Generate state-DOT-style monthly progress estimate PDFs grouped by spec section.",
  HEAVY_CIVIL_PRESET: "Activate the heavy-civil dashboard layout, bundled features, and DOT-focused defaults for this organization.",
};

export const FEATURE_FLAG_CATEGORIES = [
  "Core Platform",
  "Integrations",
  "Enterprise & Compliance",
  "Field & Mobile",
  "Hiring",
  "Advanced Tech",
  "Communications",
  "Heavy Civil & DOT",
] as const;
export type FeatureFlagCategory = (typeof FEATURE_FLAG_CATEGORIES)[number];

export const FEATURE_FLAG_CATEGORY_MAP: Record<FeatureFlagKey, FeatureFlagCategory> = {
  INTEGRATIONS_HUB: "Core Platform",
  APPROVALS_FRAMEWORK: "Core Platform",
  DOCUMENT_CONTROL: "Core Platform",
  PROJECT_HEALTH_SCORE: "Core Platform",
  EXECUTIVE_DIGEST: "Core Platform",

  INTEGRATION_QBO: "Integrations",
  INTEGRATION_GOOGLE: "Integrations",
  INTEGRATION_MICROSOFT: "Integrations",
  INTEGRATION_ESIGN: "Integrations",
  INTEGRATION_ZAPIER: "Integrations",

  SSO: "Enterprise & Compliance",
  AUDIT_EXPORT: "Enterprise & Compliance",
  DATA_RETENTION: "Enterprise & Compliance",
  PRIVACY_COMPLIANCE: "Enterprise & Compliance",
  SESSION_MANAGEMENT: "Enterprise & Compliance",
  AI_GOVERNANCE: "Enterprise & Compliance",
  REVENUE_RECOGNITION: "Enterprise & Compliance",

  MOBILE_OFFLINE_V2: "Field & Mobile",

  HIRING_MODULE: "Hiring",
  HIRING_AI_SCORING: "Hiring",
  HIRING_AUTO_TASKS: "Hiring",
  HIRING_ATS_SYNC: "Hiring",

  BIM_VIEWER: "Advanced Tech",
  WHATIF_SIMULATOR: "Advanced Tech",
  LIDAR_SCANNER: "Advanced Tech",

  VIDEO_CALLS: "Communications",
  SMS_NOTIFICATIONS: "Communications",

  DOT_PAY_ITEMS: "Heavy Civil & DOT",
  DBE_TRACKING: "Heavy Civil & DOT",
  WH_347_PAYROLL: "Heavy Civil & DOT",
  HAUL_TICKETS: "Heavy Civil & DOT",
  DAILY_INSPECTOR_REPORTS: "Heavy Civil & DOT",
  SWPPP_INSPECTIONS: "Heavy Civil & DOT",
  SURETY_BONDS: "Heavy Civil & DOT",
  BUY_AMERICA: "Heavy Civil & DOT",
  MASS_HAUL_ANALYZER: "Heavy Civil & DOT",
  DOT_PROGRESS_ESTIMATE: "Heavy Civil & DOT",
  HEAVY_CIVIL_PRESET: "Heavy Civil & DOT",
};

export const HEAVY_CIVIL_TRADE_TYPES: readonly string[] = [
  "ROADWAY_CONSTRUCTION",
  "TRAFFIC_CONTROL",
  "STRIPING_AND_SIGNAGE",
  "EROSION_CONTROL",
  "MASS_EXCAVATION",
  "STORMWATER_SYSTEMS",
  "SANITARY_SEWER",
  "WATERLINE",
  "FORCE_MAIN",
  "CURB_AND_GUTTER",
  "SIDEWALK",
  "CONCRETE_PAVING",
  "ASPHALT_PAVING",
  "TRENCHING",
  "SHORING",
  "DEWATERING",
  "SOIL_STABILIZATION",
];

export function isHeavyCivilTrade(tradeType: string | null | undefined): boolean {
  return !!tradeType && HEAVY_CIVIL_TRADE_TYPES.includes(tradeType);
}

export const DISABLED_BY_DEFAULT_FLAGS: readonly FeatureFlagKey[] = [
  "BIM_VIEWER",
  "REVENUE_RECOGNITION",
  "WHATIF_SIMULATOR",
  "LIDAR_SCANNER",
  "VIDEO_CALLS",
  "SMS_NOTIFICATIONS",
  "DOT_PAY_ITEMS",
  "DBE_TRACKING",
  "WH_347_PAYROLL",
  "HAUL_TICKETS",
  "DAILY_INSPECTOR_REPORTS",
  "SWPPP_INSPECTIONS",
  "SURETY_BONDS",
  "BUY_AMERICA",
  "MASS_HAUL_ANALYZER",
  "DOT_PROGRESS_ESTIMATE",
  "HEAVY_CIVIL_PRESET",
] as const;

export const aiSettings = pgTable("ai_settings", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  dailyRunsEnabled: boolean("daily_runs_enabled").notNull().default(true),
  dailyRunTime: text("daily_run_time").notNull().default("06:00"),
  roleTasksEnabled: boolean("role_tasks_enabled").notNull().default(true),
  billingAlertsEnabled: boolean("billing_alerts_enabled").notNull().default(true),
  profitabilityWarningsEnabled: boolean("profitability_warnings_enabled").notNull().default(true),
  crewSchedulingEnabled: boolean("crew_scheduling_enabled").notNull().default(true),
  bidRemindersEnabled: boolean("bid_reminders_enabled").notNull().default(true),
  materialOrderingEnabled: boolean("material_ordering_enabled").notNull().default(true),
  modelName: text("model_name").notNull().default("gpt-5"),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// AI Runs table
export const aiRuns = pgTable("ai_runs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  runType: text("run_type").notNull().default("daily"),
  status: text("status").notNull().default("in_progress"),
  triggeredById: varchar("triggered_by_id").references(() => users.id),
  snapshotData: text("snapshot_data"),
  profitabilityData: text("profitability_data"),
  aiResponse: text("ai_response"),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  completedAt: timestamp("completed_at"),
}, (table) => ({
  createdAtIdx: index("ai_runs_created_at_idx").on(table.createdAt),
}));

// AI Tasks table (role-based prioritized tasks)
export const aiTasks = pgTable("ai_tasks", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  runId: varchar("run_id").notNull().references(() => aiRuns.id, { onDelete: "cascade" }),
  taskType: text("task_type").notNull(),
  role: userRoleEnum("role").notNull(),
  title: text("title").notNull(),
  description: text("description").notNull(),
  priority: aiTaskPriorityEnum("priority").notNull().default("MEDIUM"),
  status: aiTaskStatusEnum("status").notNull().default("PENDING"),
  dueDate: timestamp("due_date"),
  projectId: varchar("project_id").references(() => projects.id, { onDelete: "cascade" }),
  projectCode: text("project_code"),
  metadata: text("metadata"),
  assignedToId: varchar("assigned_to_id").references(() => users.id, { onDelete: "set null" }),
  completedAt: timestamp("completed_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  roleIdx: index("ai_tasks_role_idx").on(table.role),
  statusIdx: index("ai_tasks_status_idx").on(table.status),
  priorityIdx: index("ai_tasks_priority_idx").on(table.priority),
}));

// AI Insight Module Types
export const aiInsights = pgTable("ai_insights", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  projectId: varchar("project_id").references(() => projects.id, { onDelete: "cascade" }),
  module: aiInsightModuleEnum("module").notNull(),
  severity: aiInsightSeverityEnum("severity").notNull().default("INFO"),
  title: text("title").notNull(),
  summary: text("summary").notNull(),
  details: text("details"),
  recommendations: text("recommendations").array(),
  metrics: text("metrics"), // JSON string for module-specific metrics
  affectedEntities: text("affected_entities"), // JSON string for related IDs
  estimatedImpact: text("estimated_impact"), // Cost/time impact description
  actionItems: text("action_items"), // JSON string for specific actions
  isAcknowledged: boolean("is_acknowledged").notNull().default(false),
  acknowledgedById: varchar("acknowledged_by_id").references(() => users.id),
  acknowledgedAt: timestamp("acknowledged_at"),
  triggeredById: varchar("triggered_by_id").references(() => users.id),
  expiresAt: timestamp("expires_at"), // Insights can auto-expire
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  moduleIdx: index("ai_insights_module_idx").on(table.module),
  orgIdx: index("ai_insights_org_idx").on(table.organizationId),
  projectIdx: index("ai_insights_project_idx").on(table.projectId),
  severityIdx: index("ai_insights_severity_idx").on(table.severity),
  createdAtIdx: index("ai_insights_created_at_idx").on(table.createdAt),
}));

// AI Gantt Recommendations (AI-generated scheduling suggestions)
export const aiGanttRecommendations = pgTable("ai_gantt_recommendations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  insightId: varchar("insight_id").references(() => aiInsights.id, { onDelete: "cascade" }),
  recommendationType: text("recommendation_type").notNull(), // TASK_ORDER, RESOURCE_ALLOCATION, CRITICAL_PATH, PARALLEL_WORK
  title: text("title").notNull(),
  description: text("description").notNull(),
  suggestedTasks: text("suggested_tasks"), // JSON array of task suggestions
  suggestedDependencies: text("suggested_dependencies"), // JSON array of dependencies
  estimatedDaysImprovement: integer("estimated_days_improvement"),
  estimatedCostSavings: decimal("estimated_cost_savings", { precision: 12, scale: 2 }),
  isApplied: boolean("is_applied").notNull().default(false),
  appliedById: varchar("applied_by_id").references(() => users.id),
  appliedAt: timestamp("applied_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  projectIdx: index("ai_gantt_recommendations_project_idx").on(table.projectId),
}));

// AI Vendor Comparisons (best pricing analysis)
export const aiVendorComparisons = pgTable("ai_vendor_comparisons", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  insightId: varchar("insight_id").references(() => aiInsights.id, { onDelete: "cascade" }),
  materialCategory: text("material_category").notNull(),
  analysisData: text("analysis_data").notNull(), // JSON with vendor comparisons
  recommendedVendorId: varchar("recommended_vendor_id"),
  recommendedVendorName: text("recommended_vendor_name"),
  potentialSavings: decimal("potential_savings", { precision: 12, scale: 2 }),
  priceConfidence: integer("price_confidence"), // 0-100 confidence score
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  orgIdx: index("ai_vendor_comparisons_org_idx").on(table.organizationId),
  categoryIdx: index("ai_vendor_comparisons_category_idx").on(table.materialCategory),
}));

// AI Bid Document Analysis (AI-powered bid invitation/scope document review)
export const aiBidDocumentAnalysis = pgTable("ai_bid_document_analysis", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  bidId: varchar("bid_id").references(() => bids.id, { onDelete: "cascade" }),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  documentUrl: text("document_url").notNull(),
  documentName: text("document_name").notNull(),
  documentType: text("document_type"), // PDF, IMAGE, etc.
  status: aiBidDocumentAnalysisStatusEnum("status").notNull().default("PENDING"),
  
  // Extracted information
  projectName: text("project_name"),
  clientName: text("client_name"),
  bidDueDate: timestamp("bid_due_date"),
  projectLocation: text("project_location"),
  projectScope: text("project_scope"), // Full scope description
  scopeSummary: text("scope_summary"), // Short summary
  
  // Extracted line items as JSON array
  lineItems: text("line_items"), // JSON: [{description, quantity, unit, notes}]
  
  // Special requirements/qualifications
  requirements: text("requirements"), // JSON array of requirements
  qualifications: text("qualifications"), // JSON array of qualifications needed
  insuranceRequirements: text("insurance_requirements"),
  bondingRequirements: text("bonding_requirements"),
  
  // Pricing guidance
  suggestedPricingFactors: text("suggested_pricing_factors"), // JSON with pricing considerations
  riskFactors: text("risk_factors"), // JSON array of potential risks
  
  // Raw AI response for debugging
  rawAiResponse: text("raw_ai_response"),
  confidenceScore: integer("confidence_score"), // 0-100
  
  analyzedById: varchar("analyzed_by_id").references(() => users.id),
  analyzedAt: timestamp("analyzed_at"),
  errorMessage: text("error_message"),
  
  // Soft delete / Archive fields
  isArchived: boolean("is_archived").notNull().default(false),
  archivedAt: timestamp("archived_at"),
  
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  bidIdx: index("ai_bid_document_analysis_bid_idx").on(table.bidId),
  orgIdx: index("ai_bid_document_analysis_org_idx").on(table.organizationId),
  statusIdx: index("ai_bid_document_analysis_status_idx").on(table.status),
  archivedIdx: index("ai_bid_document_analysis_archived_idx").on(table.isArchived),
}));

// AI Contract/Award Document Analysis (AI-powered award/contract document review)
export const aiContractDocumentAnalysis = pgTable("ai_contract_document_analysis", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: varchar("project_id").references(() => projects.id, { onDelete: "cascade" }),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  documentUrl: text("document_url").notNull(),
  documentName: text("document_name").notNull(),
  documentType: text("document_type"), // PDF, IMAGE, etc.
  status: aiContractDocumentAnalysisStatusEnum("status").notNull().default("PENDING"),
  
  // Contract basics
  contractType: text("contract_type"), // Subcontract, Prime Contract, Change Order, Amendment
  contractNumber: text("contract_number"),
  contractDate: timestamp("contract_date"),
  effectiveDate: timestamp("effective_date"),
  completionDate: timestamp("completion_date"),
  
  // Parties
  ownerName: text("owner_name"),
  generalContractorName: text("general_contractor_name"),
  subcontractorName: text("subcontractor_name"),
  ownerAddress: text("owner_address"),
  gcAddress: text("gc_address"),
  projectName: text("project_name"),
  projectLocation: text("project_location"),
  
  // Contract value and payment
  contractValue: decimal("contract_value", { precision: 14, scale: 2 }),
  retainage: decimal("retainage", { precision: 5, scale: 2 }), // Percentage
  paymentTerms: text("payment_terms"),
  billingSchedule: text("billing_schedule"), // Monthly, milestone-based, etc.
  
  // Scope and work
  scopeOfWork: text("scope_of_work"), // Full scope description
  scopeSummary: text("scope_summary"), // Short summary
  scopeItems: text("scope_items"), // JSON: [{section, description, inclusions, exclusions}]
  exclusions: text("exclusions"), // JSON array of explicit exclusions
  
  // Schedule
  startDate: timestamp("start_date"),
  duration: text("duration"), // "90 days", "3 months", etc.
  milestones: text("milestones"), // JSON: [{name, date, description}]
  liquidatedDamages: text("liquidated_damages"),
  
  // Insurance and bonding
  insuranceRequirements: text("insurance_requirements"), // JSON with limits
  bondingRequirements: text("bonding_requirements"),
  
  // Terms and conditions
  warrantyTerms: text("warranty_terms"),
  changeOrderProcess: text("change_order_process"),
  disputeResolution: text("dispute_resolution"),
  terminationClauses: text("termination_clauses"),
  indemnificationClauses: text("indemnification_clauses"),
  
  // Key clauses extracted
  keyTerms: text("key_terms"), // JSON: [{term, summary, section}]
  riskFactors: text("risk_factors"), // JSON: [{risk, severity, mitigation, section}]
  obligations: text("obligations"), // JSON: [{type, description, deadline}]
  
  // Raw AI response for debugging
  rawAiResponse: text("raw_ai_response"),
  confidenceScore: integer("confidence_score"), // 0-100
  
  analyzedById: varchar("analyzed_by_id").references(() => users.id),
  analyzedAt: timestamp("analyzed_at"),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  projectIdx: index("ai_contract_document_analysis_project_idx").on(table.projectId),
  orgIdx: index("ai_contract_document_analysis_org_idx").on(table.organizationId),
  statusIdx: index("ai_contract_document_analysis_status_idx").on(table.status),
}));

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

// Takeoff Sheets table (per-page images from PDFs)
export const takeoffSheets = pgTable("takeoff_sheets", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: varchar("project_id").references(() => projects.id, { onDelete: "cascade" }),
  bidId: varchar("bid_id").references(() => bids.id, { onDelete: "cascade" }),
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
  deductions: text("deductions"),
  metadata: text("metadata"),
  subcontractorId: varchar("subcontractor_id"),
  supplierId: varchar("supplier_id"),
  locationTag: text("location_tag"),
  installationStatus: installationStatusEnum("installation_status").default("NOT_STARTED"),
  originMeasurementId: varchar("origin_measurement_id"),
  installedQuantity: doublePrecision("installed_quantity"),
  installedById: varchar("installed_by_id").references(() => users.id, { onDelete: "set null" }),
  installedAt: timestamp("installed_at"),
  photoUrls: text("photo_urls"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  sheetIdx: index("takeoff_measurements_sheet_idx").on(table.sheetId),
  categoryIdx: index("takeoff_measurements_category_idx").on(table.categoryId),
  groupIdx: index("takeoff_measurements_group_idx").on(table.groupId),
  locationIdx: index("takeoff_measurements_location_idx").on(table.locationId),
  typeIdx: index("takeoff_measurements_type_idx").on(table.type),
  statusIdx: index("takeoff_measurements_status_idx").on(table.status),
  versionIdx: index("takeoff_measurements_version_idx").on(table.takeoffVersionId),
}));

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

// Estimate Settings table (global cost settings and rates)
export const estimateSettings = pgTable("estimate_settings", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  defaultMaterialPrices: text("default_material_prices").notNull().default('{}'),
  defaultLaborRates: text("default_labor_rates").notNull().default('{}'),
  defaultEquipmentRates: text("default_equipment_rates").notNull().default('{}'),
  defaultProductionRates: text("default_production_rates").notNull().default('{}'),
  defaultOverheadPercent: doublePrecision("default_overhead_percent").notNull().default(15),
  defaultProfitMarginPercent: doublePrecision("default_profit_margin_percent").notNull().default(20),
  defaultMarkups: text("default_markups").notNull().default('{}'),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Estimate Crews table (crew definitions and production rates)
export const estimateCrews = pgTable("estimate_crews", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  description: text("description"),
  members: text("members").notNull().default('[]'),
  blendedRatePerHour: decimal("blended_rate_per_hour", { precision: 10, scale: 2 }).notNull(),
  productionRateMapping: text("production_rate_mapping").notNull().default('{}'),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Stone type enum for sub-base calculations
export const estimateVersions = pgTable("estimate_versions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  estimateId: varchar("estimate_id").notNull().references(() => estimates.id, { onDelete: "cascade" }),
  versionNumber: integer("version_number").notNull(),
  snapshot: text("snapshot").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  estimateIdx: index("estimate_versions_estimate_idx").on(table.estimateId),
}));

// Estimate Vendor Quotes table (uploaded vendor/material quotes)
export const estimateVendorQuotes = pgTable("estimate_vendor_quotes", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  estimateId: varchar("estimate_id").notNull().references(() => estimates.id, { onDelete: "cascade" }),
  vendorName: text("vendor_name").notNull(),
  contactInfo: text("contact_info"),
  scopeDescription: text("scope_description").notNull(),
  quoteAmount: decimal("quote_amount", { precision: 12, scale: 2 }).notNull(),
  fileUrl: text("file_url"),
  fileName: text("file_name"),
  fileSize: integer("file_size"),
  mimeType: text("mime_type"),
  linkedLineItemIds: text("linked_line_item_ids").notNull().default('[]'),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  estimateIdx: index("estimate_vendor_quotes_estimate_idx").on(table.estimateId),
}));

// Estimate History table (for production rate tracking)
export const estimateHistory = pgTable("estimate_history", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  estimateId: varchar("estimate_id").references(() => estimates.id, { onDelete: "cascade" }),
  data: text("data").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// Insert and Select Schemas
export type SelectUser = Omit<typeof users.$inferSelect, 'passwordHash'>;

export const insertAISettingsSchema = createInsertSchema(aiSettings).omit({
  id: true,
  updatedAt: true,
});

export const insertAIRunSchema = createInsertSchema(aiRuns).omit({
  id: true,
  createdAt: true,
  completedAt: true,
});

export const insertAITaskSchema = createInsertSchema(aiTasks).omit({
  id: true,
  createdAt: true,
  completedAt: true,
});

export type InsertAISettings = z.infer<typeof insertAISettingsSchema>;
export type AISettings = typeof aiSettings.$inferSelect;

export type InsertAIRun = z.infer<typeof insertAIRunSchema>;
export type AIRun = typeof aiRuns.$inferSelect;

export type InsertAITask = z.infer<typeof insertAITaskSchema>;
export type AITask = typeof aiTasks.$inferSelect;

// AI Insights schemas and types
export const insertAIInsightSchema = createInsertSchema(aiInsights).omit({
  id: true,
  createdAt: true,
  acknowledgedAt: true,
});
export type InsertAIInsight = z.infer<typeof insertAIInsightSchema>;
export type AIInsight = typeof aiInsights.$inferSelect;

export const insertAIGanttRecommendationSchema = createInsertSchema(aiGanttRecommendations).omit({
  id: true,
  createdAt: true,
  appliedAt: true,
});
export type InsertAIGanttRecommendation = z.infer<typeof insertAIGanttRecommendationSchema>;
export type AIGanttRecommendation = typeof aiGanttRecommendations.$inferSelect;

export const insertAIVendorComparisonSchema = createInsertSchema(aiVendorComparisons).omit({
  id: true,
  createdAt: true,
});
export type InsertAIVendorComparison = z.infer<typeof insertAIVendorComparisonSchema>;
export type AIVendorComparison = typeof aiVendorComparisons.$inferSelect;

export const insertAIBidDocumentAnalysisSchema = createInsertSchema(aiBidDocumentAnalysis).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertAIBidDocumentAnalysis = z.infer<typeof insertAIBidDocumentAnalysisSchema>;
export type AIBidDocumentAnalysis = typeof aiBidDocumentAnalysis.$inferSelect;

export const insertAIContractDocumentAnalysisSchema = createInsertSchema(aiContractDocumentAnalysis).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertAIContractDocumentAnalysis = z.infer<typeof insertAIContractDocumentAnalysisSchema>;
export type AIContractDocumentAnalysis = typeof aiContractDocumentAnalysis.$inferSelect;

// Crews table
export const crews = pgTable("crews", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id),
  name: text("name").notNull(),
  description: text("description"),
  leadId: varchar("lead_id").references(() => users.id),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertCrewSchema = createInsertSchema(crews).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertCrew = z.infer<typeof insertCrewSchema>;
export type Crew = typeof crews.$inferSelect;

// Crew Members table
export const crewMembers = pgTable("crew_members", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  crewId: varchar("crew_id").notNull().references(() => crews.id, { onDelete: "cascade" }),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  role: text("role"),
  addedAt: timestamp("added_at").notNull().defaultNow(),
});

export const insertCrewMemberSchema = createInsertSchema(crewMembers).omit({ id: true, addedAt: true });
export type InsertCrewMember = z.infer<typeof insertCrewMemberSchema>;
export type CrewMember = typeof crewMembers.$inferSelect;

// Skills table
export const skills = pgTable("skills", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull().unique(),
  category: text("category"),
  description: text("description"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertSkillSchema = createInsertSchema(skills).omit({ id: true, createdAt: true });
export type InsertSkill = z.infer<typeof insertSkillSchema>;
export type Skill = typeof skills.$inferSelect;

// User Skills table (junction table)
export const userSkills = pgTable("user_skills", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  skillId: varchar("skill_id").notNull().references(() => skills.id, { onDelete: "cascade" }),
  proficiencyLevel: text("proficiency_level"),
  starRating: integer("star_rating").default(0),
  yearsExperience: integer("years_experience"),
  certifiedAt: timestamp("certified_at"),
  verificationStatus: text("verification_status").default("unverified"),
  verifiedByUserId: varchar("verified_by_user_id"),
  verifiedAt: timestamp("verified_at"),
  addedAt: timestamp("added_at").notNull().defaultNow(),
});

export const insertUserSkillSchema = createInsertSchema(userSkills).omit({ id: true, addedAt: true });
export type InsertUserSkill = z.infer<typeof insertUserSkillSchema>;
export type UserSkill = typeof userSkills.$inferSelect;

// Skill Verification Requests
export const skillVerificationRequests = pgTable("skill_verification_requests", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userSkillId: varchar("user_skill_id").notNull().references(() => userSkills.id, { onDelete: "cascade" }),
  requestedByUserId: varchar("requested_by_user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  requestedToUserId: varchar("requested_to_user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  organizationId: varchar("organization_id").notNull(),
  status: text("status").notNull().default("pending"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  resolvedAt: timestamp("resolved_at"),
});

export const insertSkillVerificationRequestSchema = createInsertSchema(skillVerificationRequests).omit({ id: true, createdAt: true, resolvedAt: true });
export type InsertSkillVerificationRequest = z.infer<typeof insertSkillVerificationRequestSchema>;
export type SkillVerificationRequest = typeof skillVerificationRequests.$inferSelect;

// User Certifications
export const userCertifications = pgTable("user_certifications", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  organizationId: varchar("organization_id").notNull(),
  certificationName: text("certification_name").notNull(),
  issuedDate: timestamp("issued_date"),
  expiryDate: timestamp("expiry_date"),
  fileUrl: text("file_url"),
  fileObjectKey: text("file_object_key"),
  fileName: text("file_name"),
  status: text("status").notNull().default("active"),
  expiryNotified30Days: boolean("expiry_notified_30_days").default(false),
  expiryNotified5Days: boolean("expiry_notified_5_days").default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertUserCertificationSchema = createInsertSchema(userCertifications).omit({ id: true, createdAt: true, updatedAt: true, expiryNotified30Days: true, expiryNotified5Days: true });
export type InsertUserCertification = z.infer<typeof insertUserCertificationSchema>;
export type UserCertification = typeof userCertifications.$inferSelect;

// User Equipment Competencies
export const userEquipmentCompetencies = pgTable("user_equipment_competencies", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  organizationId: varchar("organization_id").notNull(),
  equipmentName: text("equipment_name").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertUserEquipmentCompetencySchema = createInsertSchema(userEquipmentCompetencies).omit({ id: true, createdAt: true });
export type InsertUserEquipmentCompetency = z.infer<typeof insertUserEquipmentCompetencySchema>;
export type UserEquipmentCompetency = typeof userEquipmentCompetencies.$inferSelect;

// User Photos table - profile photo gallery
export const userPhotos = pgTable("user_photos", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  fileName: text("file_name").notNull(),
  fileUrl: text("file_url").notNull(),
  objectKey: text("object_key"),
  uploadedAt: timestamp("uploaded_at").notNull().defaultNow(),
});

export const insertUserPhotoSchema = createInsertSchema(userPhotos).omit({ id: true, uploadedAt: true });
export type InsertUserPhoto = z.infer<typeof insertUserPhotoSchema>;
export type UserPhoto = typeof userPhotos.$inferSelect;

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

// Crew Project Assignments table
export const crewProjectAssignments = pgTable("crew_project_assignments", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  crewId: varchar("crew_id").notNull().references(() => crews.id, { onDelete: "cascade" }),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  startDate: timestamp("start_date"),
  endDate: timestamp("end_date"),
  assignedById: varchar("assigned_by_id").notNull().references(() => users.id),
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertCrewProjectAssignmentSchema = createInsertSchema(crewProjectAssignments).omit({ id: true, createdAt: true });
export type InsertCrewProjectAssignment = z.infer<typeof insertCrewProjectAssignmentSchema>;
export type CrewProjectAssignment = typeof crewProjectAssignments.$inferSelect;

// AI Data Quality table
export const aiDataQuality = pgTable("ai_data_quality", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  overallScore: integer("overall_score").notNull(),
  financialDataScore: integer("financial_data_score").notNull(),
  laborDataScore: integer("labor_data_score").notNull(),
  materialDataScore: integer("material_data_score").notNull(),
  timelineDataScore: integer("timeline_data_score").notNull(),
  scopeDataScore: integer("scope_data_score").notNull(),
  missingFields: text("missing_fields").array(),
  recommendations: text("recommendations").array(),
  calculatedAt: timestamp("calculated_at").notNull().defaultNow(),
});

export const insertAIDataQualitySchema = createInsertSchema(aiDataQuality).omit({ id: true, calculatedAt: true });
export type InsertAIDataQuality = z.infer<typeof insertAIDataQualitySchema>;
export type AIDataQuality = typeof aiDataQuality.$inferSelect;

// Subcontractors table
export const subcontractors = pgTable("subcontractors", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyName: text("company_name").notNull(),
  contactName: text("contact_name"),
  email: text("email"),
  phone: text("phone"),
  address: text("address"),
  specialties: text("specialties").array(),
  insuranceExpiration: timestamp("insurance_expiration"),
  notes: text("notes"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertSubcontractorSchema = createInsertSchema(subcontractors).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertSubcontractor = z.infer<typeof insertSubcontractorSchema>;
export type Subcontractor = typeof subcontractors.$inferSelect;

// Subcontractor Contracts table
export const subcontractorContracts = pgTable("subcontractor_contracts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  subcontractorId: varchar("subcontractor_id").notNull().references(() => crmOrganisations.id, { onDelete: "cascade" }),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  contractNumber: text("contract_number").notNull(),
  scopeOfWork: text("scope_of_work").notNull(),
  contractAmount: decimal("contract_amount", { precision: 12, scale: 2 }).notNull(),
  startDate: timestamp("start_date"),
  completionDate: timestamp("completion_date"),
  status: text("status").notNull().default("PENDING"),
  paymentTerms: text("payment_terms"),
  retentionPercent: decimal("retention_percent", { precision: 5, scale: 2 }),
  notes: text("notes"),
  costCode: text("cost_code"),
  billingFrequency: text("billing_frequency").default("MONTHLY"),
  paymentDueDays: integer("payment_due_days").default(30),
  earlyPayDiscount: decimal("early_pay_discount", { precision: 5, scale: 2 }),
  lienWaiverRequired: boolean("lien_waiver_required").default(false),
  createdById: varchar("created_by_id").notNull().references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertSubcontractorContractSchema = createInsertSchema(subcontractorContracts).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertSubcontractorContract = z.infer<typeof insertSubcontractorContractSchema>;
export type SubcontractorContract = typeof subcontractorContracts.$inferSelect;

// Subcontractor Payments table - tracks payable requests from contract completion through payment
export const subcontractorPayments = pgTable("subcontractor_payments", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  contractId: varchar("contract_id").notNull().references(() => subcontractorContracts.id, { onDelete: "cascade" }),
  paymentNumber: integer("payment_number").notNull(),
  amount: decimal("amount", { precision: 12, scale: 2 }).notNull(),
  retentionHeld: decimal("retention_held", { precision: 12, scale: 2 }),
  paymentDate: timestamp("payment_date"),
  description: text("description"),
  invoiceNumber: text("invoice_number"),
  // Status workflow: PENDING -> APPROVED -> PAID (or REJECTED)
  status: text("status").notNull().default("PENDING"),
  // Approval tracking
  approvedById: varchar("approved_by_id").references(() => users.id),
  approvedAt: timestamp("approved_at"),
  // Rejection tracking
  rejectedById: varchar("rejected_by_id").references(() => users.id),
  rejectedAt: timestamp("rejected_at"),
  rejectionReason: text("rejection_reason"),
  // Payment tracking
  paidById: varchar("paid_by_id").references(() => users.id),
  paidAt: timestamp("paid_at"),
  checkNumber: text("check_number"),
  paymentMethod: text("payment_method"), // CHECK, ACH, WIRE, CREDIT_CARD, CASH
  // Auto-creation flag (from contract completion)
  autoCreated: boolean("auto_created").notNull().default(false),
  createdById: varchar("created_by_id").references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  orgIdx: index("subcontractor_payments_org_idx").on(table.organizationId),
  contractIdx: index("subcontractor_payments_contract_idx").on(table.contractId),
  statusIdx: index("subcontractor_payments_status_idx").on(table.status),
}));

export const insertSubcontractorPaymentSchema = createInsertSchema(subcontractorPayments).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertSubcontractorPayment = z.infer<typeof insertSubcontractorPaymentSchema>;
export type SubcontractorPayment = typeof subcontractorPayments.$inferSelect;

// Subcontractor Billing Schedule table
export const subcontractorBillingSchedule = pgTable("subcontractor_billing_schedule", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  contractId: varchar("contract_id").notNull().references(() => subcontractorContracts.id, { onDelete: "cascade" }),
  milestoneNumber: integer("milestone_number").notNull(),
  description: text("description").notNull(),
  scheduledAmount: decimal("scheduled_amount", { precision: 12, scale: 2 }).notNull(),
  scheduledDate: timestamp("scheduled_date"),
  completionPercent: integer("completion_percent"),
  status: text("status").notNull().default("PENDING"),
  completedAt: timestamp("completed_at"),
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertSubcontractorBillingScheduleSchema = createInsertSchema(subcontractorBillingSchedule).omit({ id: true, createdAt: true });
export type InsertSubcontractorBillingSchedule = z.infer<typeof insertSubcontractorBillingScheduleSchema>;
export type SubcontractorBillingSchedule = typeof subcontractorBillingSchedule.$inferSelect;

export const subcontractSovLineItems = pgTable("subcontract_sov_line_items", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  contractId: varchar("contract_id").notNull().references(() => subcontractorContracts.id, { onDelete: "cascade" }),
  itemNumber: integer("item_number").notNull(),
  description: text("description").notNull(),
  scheduledValue: decimal("scheduled_value", { precision: 12, scale: 2 }).notNull(),
  originalValue: decimal("original_value", { precision: 12, scale: 2 }),
  changeOrderRef: text("change_order_ref"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  contractIdx: index("sub_sov_contract_idx").on(table.contractId),
}));

export const insertSubcontractSovLineItemSchema = createInsertSchema(subcontractSovLineItems).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertSubcontractSovLineItem = z.infer<typeof insertSubcontractSovLineItemSchema>;
export type SubcontractSovLineItem = typeof subcontractSovLineItems.$inferSelect;

export const subPayApplications = pgTable("sub_pay_applications", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  contractId: varchar("contract_id").notNull().references(() => subcontractorContracts.id, { onDelete: "cascade" }),
  applicationNumber: integer("application_number").notNull(),
  periodTo: text("period_to"),
  status: text("status").notNull().default("DRAFT"),
  totalScheduledValue: decimal("total_scheduled_value", { precision: 12, scale: 2 }),
  totalCompletedPrevious: decimal("total_completed_previous", { precision: 12, scale: 2 }),
  totalCompletedThisPeriod: decimal("total_completed_this_period", { precision: 12, scale: 2 }),
  totalMaterialsStored: decimal("total_materials_stored", { precision: 12, scale: 2 }),
  totalCompletedToDate: decimal("total_completed_to_date", { precision: 12, scale: 2 }),
  totalRetentionHeld: decimal("total_retention_held", { precision: 12, scale: 2 }),
  netAmountDue: decimal("net_amount_due", { precision: 12, scale: 2 }),
  submittedAt: timestamp("submitted_at"),
  reviewedAt: timestamp("reviewed_at"),
  approvedAt: timestamp("approved_at"),
  approvedById: varchar("approved_by_id").references(() => users.id),
  paidAt: timestamp("paid_at"),
  rejectionReason: text("rejection_reason"),
  createdById: varchar("created_by_id").references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  contractIdx: index("sub_pay_app_contract_idx").on(table.contractId),
  statusIdx: index("sub_pay_app_status_idx").on(table.status),
}));

export const insertSubPayApplicationSchema = createInsertSchema(subPayApplications).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertSubPayApplication = z.infer<typeof insertSubPayApplicationSchema>;
export type SubPayApplication = typeof subPayApplications.$inferSelect;

export const subPayAppLineItems = pgTable("sub_pay_app_line_items", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  payAppId: varchar("pay_app_id").notNull().references(() => subPayApplications.id, { onDelete: "cascade" }),
  sovLineItemId: varchar("sov_line_item_id").notNull().references(() => subcontractSovLineItems.id, { onDelete: "cascade" }),
  previouslyCompleted: decimal("previously_completed", { precision: 12, scale: 2 }).default("0"),
  completedThisPeriod: decimal("completed_this_period", { precision: 12, scale: 2 }).default("0"),
  materialsStored: decimal("materials_stored", { precision: 12, scale: 2 }).default("0"),
  totalCompleted: decimal("total_completed", { precision: 12, scale: 2 }).default("0"),
  percentComplete: decimal("percent_complete", { precision: 5, scale: 2 }).default("0"),
  retentionHeld: decimal("retention_held", { precision: 12, scale: 2 }).default("0"),
}, (table) => ({
  payAppIdx: index("sub_pay_app_line_pay_app_idx").on(table.payAppId),
}));

export const insertSubPayAppLineItemSchema = createInsertSchema(subPayAppLineItems).omit({ id: true });
export type InsertSubPayAppLineItem = z.infer<typeof insertSubPayAppLineItemSchema>;
export type SubPayAppLineItem = typeof subPayAppLineItems.$inferSelect;

export const subRetentionReleases = pgTable("sub_retention_releases", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  contractId: varchar("contract_id").notNull().references(() => subcontractorContracts.id, { onDelete: "cascade" }),
  amount: decimal("amount", { precision: 12, scale: 2 }).notNull(),
  releaseType: text("release_type").notNull().default("PARTIAL"),
  status: text("status").notNull().default("PENDING"),
  reason: text("reason"),
  approvedById: varchar("approved_by_id").references(() => users.id),
  approvedAt: timestamp("approved_at"),
  rejectedById: varchar("rejected_by_id").references(() => users.id),
  rejectedAt: timestamp("rejected_at"),
  rejectionReason: text("rejection_reason"),
  requestedById: varchar("requested_by_id").references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  contractIdx: index("sub_retention_release_contract_idx").on(table.contractId),
}));

export const insertSubRetentionReleaseSchema = createInsertSchema(subRetentionReleases).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertSubRetentionRelease = z.infer<typeof insertSubRetentionReleaseSchema>;
export type SubRetentionRelease = typeof subRetentionReleases.$inferSelect;

export const subPerformanceScores = pgTable("sub_performance_scores", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  contractId: varchar("contract_id").notNull().references(() => subcontractorContracts.id, { onDelete: "cascade" }),
  periodDate: timestamp("period_date").notNull(),
  scheduleAdherence: integer("schedule_adherence"),
  workCompletionPercent: integer("work_completion_percent"),
  qualityScore: integer("quality_score"),
  safetyIncidents: integer("safety_incidents").default(0),
  punchListItems: integer("punch_list_items").default(0),
  overallRating: decimal("overall_rating", { precision: 3, scale: 1 }),
  notes: text("notes"),
  scoredById: varchar("scored_by_id").references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  contractIdx: index("sub_perf_contract_idx").on(table.contractId),
}));

export const insertSubPerformanceScoreSchema = createInsertSchema(subPerformanceScores).omit({ id: true, createdAt: true });
export type InsertSubPerformanceScore = z.infer<typeof insertSubPerformanceScoreSchema>;
export type SubPerformanceScore = typeof subPerformanceScores.$inferSelect;

export const subcontractAttachments = pgTable("subcontract_attachments", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  contractId: varchar("contract_id").notNull().references(() => subcontractorContracts.id, { onDelete: "cascade" }),
  fileName: text("file_name").notNull(),
  fileUrl: text("file_url").notNull(),
  fileSize: integer("file_size"),
  fileType: text("file_type"),
  category: text("category").default("GENERAL"),
  uploadedById: varchar("uploaded_by_id").references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  contractIdx: index("sub_attach_contract_idx").on(table.contractId),
}));

export const insertSubcontractAttachmentSchema = createInsertSchema(subcontractAttachments).omit({ id: true, createdAt: true });
export type InsertSubcontractAttachment = z.infer<typeof insertSubcontractAttachmentSchema>;
export type SubcontractAttachment = typeof subcontractAttachments.$inferSelect;

export const sovRevisionHistory = pgTable("sov_revision_history", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  sovLineItemId: varchar("sov_line_item_id").references(() => subcontractSovLineItems.id, { onDelete: "set null" }),
  contractId: varchar("contract_id").notNull().references(() => subcontractorContracts.id, { onDelete: "cascade" }),
  revisionType: text("revision_type").notNull(),
  previousValue: text("previous_value"),
  newValue: text("new_value"),
  changeOrderRef: text("change_order_ref"),
  changedById: varchar("changed_by_id").references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  contractIdx: index("sov_rev_contract_idx").on(table.contractId),
  sovIdx: index("sov_rev_sov_idx").on(table.sovLineItemId),
}));

export const insertSovRevisionHistorySchema = createInsertSchema(sovRevisionHistory).omit({ id: true, createdAt: true });
export type InsertSovRevisionHistory = z.infer<typeof insertSovRevisionHistorySchema>;
export type SovRevisionHistory = typeof sovRevisionHistory.$inferSelect;

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
  createdById: varchar("created_by_id").references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  organizationIdx: index("crm_organisations_org_idx").on(table.organizationId),
  typeIdx: index("crm_organisations_type_idx").on(table.type),
  nameIdx: index("crm_organisations_name_idx").on(table.name),
  isDeletedIdx: index("crm_organisations_is_deleted_idx").on(table.isDeleted),
  primaryCertIdx: index("crm_organisations_primary_cert_idx").on(table.primaryCertificationType),
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
  notes: text("notes"),
  isPrimary: boolean("is_primary").notNull().default(false),
  isActive: boolean("is_active").notNull().default(true),
  createdById: varchar("created_by_id").references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  organizationIdx: index("crm_contacts_org_idx").on(table.organizationId),
  organisationIdx: index("crm_contacts_organisation_idx").on(table.organisationId),
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
  createdById: varchar("created_by_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  orgIdx: index("crm_opportunities_org_idx").on(table.organizationId),
  stageIdx: index("crm_opportunities_stage_idx").on(table.stage),
  assignedIdx: index("crm_opportunities_assigned_idx").on(table.assignedToId),
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

export const insertTakeoffMeasurementSchema = createInsertSchema(takeoffMeasurements).omit({ id: true, createdAt: true, updatedAt: true });
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

export const insertEstimateSettingsSchema = createInsertSchema(estimateSettings).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertEstimateSettings = z.infer<typeof insertEstimateSettingsSchema>;
export type EstimateSettings = typeof estimateSettings.$inferSelect;

export const insertEstimateCrewSchema = createInsertSchema(estimateCrews).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertEstimateCrew = z.infer<typeof insertEstimateCrewSchema>;
export type EstimateCrew = typeof estimateCrews.$inferSelect;

export const insertEstimateVersionSchema = createInsertSchema(estimateVersions).omit({ id: true, createdAt: true });
export type InsertEstimateVersion = z.infer<typeof insertEstimateVersionSchema>;
export type EstimateVersion = typeof estimateVersions.$inferSelect;

export const insertEstimateVendorQuoteSchema = createInsertSchema(estimateVendorQuotes).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertEstimateVendorQuote = z.infer<typeof insertEstimateVendorQuoteSchema>;
export type EstimateVendorQuote = typeof estimateVendorQuotes.$inferSelect;

export const insertEstimateHistorySchema = createInsertSchema(estimateHistory).omit({ id: true, createdAt: true });
export type InsertEstimateHistory = z.infer<typeof insertEstimateHistorySchema>;
export type EstimateHistory = typeof estimateHistory.$inferSelect;

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

// ============================================================
// INTERNAL MESSAGING SYSTEM
// Company-wide chat, group channels, and direct messages
// ============================================================

// Conversations table (channels and direct messages)
export const conversations = pgTable("conversations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  type: conversationTypeEnum("type").notNull(), // DIRECT, GROUP, COMPANY
  name: text("name"), // null for direct messages, required for groups/company
  description: text("description"),
  isCompanyChannel: boolean("is_company_channel").notNull().default(false), // The main company-wide channel
  channelSlug: text("channel_slug"), // non-null means this is a named Slack-style channel
  topic: text("topic"), // optional channel topic/purpose
  projectId: varchar("project_id").references(() => projects.id, { onDelete: "cascade" }),
  crewId: varchar("crew_id").references(() => crews.id, { onDelete: "cascade" }),
  rfiId: varchar("rfi_id").references(() => rfis.id, { onDelete: "set null" }),
  changeOrderId: varchar("change_order_id").references(() => changeOrders.id, { onDelete: "set null" }),
  taskId: varchar("task_id").references(() => tasks.id, { onDelete: "set null" }),
  isArchived: boolean("is_archived").notNull().default(false),
  createdById: varchar("created_by_id").notNull().references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  typeIdx: index("conversations_type_idx").on(table.type),
  orgIdx: index("conversations_org_idx").on(table.organizationId),
  channelSlugIdx: index("conversations_channel_slug_idx").on(table.channelSlug),
  projectIdIdx: index("conversations_project_id_idx").on(table.projectId),
  crewIdIdx: index("conversations_crew_id_idx").on(table.crewId),
  rfiIdIdx: index("conversations_rfi_id_idx").on(table.rfiId),
  changeOrderIdIdx: index("conversations_change_order_id_idx").on(table.changeOrderId),
  taskIdIdx: index("conversations_task_id_idx").on(table.taskId),
}));

// Conversation Participants table
export const conversationParticipants = pgTable("conversation_participants", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  conversationId: varchar("conversation_id").notNull().references(() => conversations.id, { onDelete: "cascade" }),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  joinedAt: timestamp("joined_at").notNull().defaultNow(),
  lastReadAt: timestamp("last_read_at"),
  isAdmin: boolean("is_admin").notNull().default(false), // For group channels
}, (table) => ({
  conversationUserIdx: index("conversation_participants_conv_user_idx").on(table.conversationId, table.userId),
  userIdx: index("conversation_participants_user_idx").on(table.userId),
  uniqueParticipant: unique("conversation_participants_unique").on(table.conversationId, table.userId),
}));

// Messages table
export const messages = pgTable("messages", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  conversationId: varchar("conversation_id").notNull().references(() => conversations.id, { onDelete: "cascade" }),
  senderId: varchar("sender_id").notNull().references(() => users.id),
  content: text("content").notNull(),
  attachmentUrl: text("attachment_url"),
  attachmentName: text("attachment_name"),
  attachmentType: text("attachment_type"),
  attachmentSize: integer("attachment_size"),
  voiceUrl: text("voice_url"),
  voiceDurationSeconds: integer("voice_duration_seconds"),
  mentionedTaskIds: text("mentioned_task_ids").array(),
  isEdited: boolean("is_edited").notNull().default(false),
  editedAt: timestamp("edited_at"),
  isDeleted: boolean("is_deleted").notNull().default(false),
  isFieldNote: boolean("is_field_note").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  conversationIdx: index("messages_conversation_idx").on(table.conversationId),
  senderIdx: index("messages_sender_idx").on(table.senderId),
  createdAtIdx: index("messages_created_at_idx").on(table.createdAt),
}));

// Message Reactions (emoji reactions on messages)
export const messageReactions = pgTable("message_reactions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  messageId: varchar("message_id").notNull().references(() => messages.id, { onDelete: "cascade" }),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  emoji: varchar("emoji", { length: 20 }).notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  messageUserEmojiIdx: unique("message_reactions_unique").on(table.messageId, table.userId, table.emoji),
  messageIdx: index("message_reactions_message_idx").on(table.messageId),
}));

// Message Read Receipts (for tracking who's read each message)
export const messageReadReceipts = pgTable("message_read_receipts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  messageId: varchar("message_id").notNull().references(() => messages.id, { onDelete: "cascade" }),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  readAt: timestamp("read_at").notNull().defaultNow(),
}, (table) => ({
  messageUserIdx: unique("message_read_receipts_unique").on(table.messageId, table.userId),
}));

export const messageEntityLinks = pgTable("message_entity_links", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  messageId: varchar("message_id").notNull().references(() => messages.id, { onDelete: "cascade" }),
  entityType: messageEntityTypeEnum("entity_type").notNull(),
  entityId: varchar("entity_id").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  messageIdx: index("message_entity_links_message_idx").on(table.messageId),
  entityIdx: index("message_entity_links_entity_idx").on(table.entityType, table.entityId),
  uniqueLink: unique("message_entity_links_unique").on(table.messageId, table.entityType, table.entityId),
}));

// Insert/Select Schemas for Messaging System
export const insertConversationSchema = createInsertSchema(conversations).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertConversation = z.infer<typeof insertConversationSchema>;
export type Conversation = typeof conversations.$inferSelect;

export const insertConversationParticipantSchema = createInsertSchema(conversationParticipants).omit({ id: true, joinedAt: true });
export type InsertConversationParticipant = z.infer<typeof insertConversationParticipantSchema>;
export type ConversationParticipant = typeof conversationParticipants.$inferSelect;

export const insertMessageSchema = createInsertSchema(messages).omit({ id: true, createdAt: true });
export type InsertMessage = z.infer<typeof insertMessageSchema>;
export type Message = typeof messages.$inferSelect;

export const insertMessageReadReceiptSchema = createInsertSchema(messageReadReceipts).omit({ id: true, readAt: true });
export type InsertMessageReadReceipt = z.infer<typeof insertMessageReadReceiptSchema>;
export type MessageReadReceipt = typeof messageReadReceipts.$inferSelect;

export const insertMessageEntityLinkSchema = createInsertSchema(messageEntityLinks).omit({ id: true, createdAt: true });
export type InsertMessageEntityLink = z.infer<typeof insertMessageEntityLinkSchema>;
export type MessageEntityLink = typeof messageEntityLinks.$inferSelect;

export const insertMessageReactionSchema = createInsertSchema(messageReactions).omit({ id: true, createdAt: true });
export type InsertMessageReaction = z.infer<typeof insertMessageReactionSchema>;
export type MessageReaction = typeof messageReactions.$inferSelect;

// Video Calls table
export const videoCalls = pgTable("video_calls", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  conversationId: varchar("conversation_id").notNull().references(() => conversations.id, { onDelete: "cascade" }),
  initiatorId: varchar("initiator_id").notNull().references(() => users.id),
  status: videoCallStatusEnum("status").notNull().default("RINGING"),
  startedAt: timestamp("started_at").notNull().defaultNow(),
  endedAt: timestamp("ended_at"),
}, (table) => ({
  conversationIdx: index("video_calls_conversation_idx").on(table.conversationId),
  statusIdx: index("video_calls_status_idx").on(table.status),
  uniqueActiveCall: uniqueIndex("video_calls_unique_active").on(table.conversationId).where(sql`status IN ('RINGING', 'ACTIVE')`),
}));

// Video Call Participants table
export const videoCallParticipants = pgTable("video_call_participants", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  callId: varchar("call_id").notNull().references(() => videoCalls.id, { onDelete: "cascade" }),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  joinedAt: timestamp("joined_at").notNull().defaultNow(),
  leftAt: timestamp("left_at"),
}, (table) => ({
  callUserIdx: unique("video_call_participants_unique").on(table.callId, table.userId),
  callIdx: index("video_call_participants_call_idx").on(table.callId),
}));

// Video Call Notes table
export const videoCallNotes = pgTable("video_call_notes", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  callId: varchar("call_id").notNull().references(() => videoCalls.id, { onDelete: "cascade" }),
  authorId: varchar("author_id").notNull().references(() => users.id),
  content: text("content").notNull().default(""),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  callIdx: index("video_call_notes_call_idx").on(table.callId),
  authorIdx: index("video_call_notes_author_idx").on(table.authorId),
}));

export const insertVideoCallSchema = createInsertSchema(videoCalls).omit({ id: true, startedAt: true });
export type InsertVideoCall = z.infer<typeof insertVideoCallSchema>;
export type VideoCall = typeof videoCalls.$inferSelect;

export const insertVideoCallParticipantSchema = createInsertSchema(videoCallParticipants).omit({ id: true, joinedAt: true });
export type InsertVideoCallParticipant = z.infer<typeof insertVideoCallParticipantSchema>;
export type VideoCallParticipant = typeof videoCallParticipants.$inferSelect;

export const insertVideoCallNoteSchema = createInsertSchema(videoCallNotes).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertVideoCallNote = z.infer<typeof insertVideoCallNoteSchema>;
export type VideoCallNote = typeof videoCallNotes.$inferSelect;

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

// Vendor Pricing Catalog - Quarterly pricing from suppliers/vendors for materials
// Used to auto-populate bid estimates with current pricing
// Unified system: manual entry + vendor portal submissions + pricebook imports
export const vendorPricingCatalogs = pgTable("vendor_pricing_catalogs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  crmOrganisationId: varchar("crm_organisation_id").notNull().references(() => crmOrganisations.id, { onDelete: "cascade" }),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }), // Contractor receiving this pricing
  
  // Item Details
  itemName: text("item_name").notNull(), // "Ready Mix Concrete 4000 PSI"
  itemCode: text("item_code"), // Vendor's SKU/item code
  category: text("category").notNull(), // CONCRETE, STONE, REBAR, LUMBER, etc.
  description: text("description"),
  unit: text("unit").notNull(), // YARD, TON, EACH, LF, SF, etc.
  
  // Pricing
  unitPrice: decimal("unit_price", { precision: 12, scale: 4 }).notNull(),
  minimumOrder: decimal("minimum_order", { precision: 10, scale: 2 }),
  deliveryFee: decimal("delivery_fee", { precision: 10, scale: 2 }),
  
  // Effective Period (Quarterly)
  effectiveQuarter: text("effective_quarter").notNull(), // "2025-Q1", "2025-Q2", etc.
  effectiveDate: timestamp("effective_date").notNull(),
  expirationDate: timestamp("expiration_date"),
  
  // Source Documentation
  sourceDocUrl: text("source_doc_url"), // Link to price sheet PDF
  sourceDocName: text("source_doc_name"),
  
  // Lead Time
  leadTimeDays: integer("lead_time_days"),
  
  // Unified Pricing Source Tracking
  sourceType: pricingSourceTypeEnum("source_type").notNull().default("MANUAL"),
  approvalStatus: pricingApprovalStatusEnum("approval_status").default("AUTO_APPROVED"),
  submittedByVendorUserId: varchar("submitted_by_vendor_user_id").references(() => users.id),
  approvedByUserId: varchar("approved_by_user_id").references(() => users.id),
  approvedAt: timestamp("approved_at"),
  pricebookImportId: varchar("pricebook_import_id"), // Reference to original pricebook if imported
  
  isActive: boolean("is_active").notNull().default(true),
  createdById: varchar("created_by_id").references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  crmOrgIdx: index("vendor_pricing_catalogs_crm_org_idx").on(table.crmOrganisationId),
  orgIdx: index("vendor_pricing_catalogs_org_idx").on(table.organizationId),
  categoryIdx: index("vendor_pricing_catalogs_category_idx").on(table.category),
  quarterIdx: index("vendor_pricing_catalogs_quarter_idx").on(table.effectiveQuarter),
  activeIdx: index("vendor_pricing_catalogs_active_idx").on(table.isActive),
  sourceIdx: index("vendor_pricing_catalogs_source_idx").on(table.sourceType),
}));

export const insertVendorPricingCatalogSchema = createInsertSchema(vendorPricingCatalogs).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertVendorPricingCatalog = z.infer<typeof insertVendorPricingCatalogSchema>;
export type VendorPricingCatalog = typeof vendorPricingCatalogs.$inferSelect;

// Vendor Enrollments - Links vendors to contractor organizations they serve
// Enables vendors to send pricing directly to enrolled clients
export const vendorEnrollments = pgTable("vendor_enrollments", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  vendorCrmOrgId: varchar("vendor_crm_org_id").notNull().references(() => crmOrganisations.id, { onDelete: "cascade" }),
  contractorOrgId: varchar("contractor_org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  
  // Enrollment Status
  status: vendorEnrollmentStatusEnum("status").notNull().default("PENDING"),
  
  // Enrollment Settings
  autoApproveNewPricing: boolean("auto_approve_new_pricing").notNull().default(false),
  notifyOnPriceUpdate: boolean("notify_on_price_update").notNull().default(true),
  
  // Invitation/Enrollment tracking
  invitedByUserId: varchar("invited_by_user_id").references(() => users.id),
  invitedAt: timestamp("invited_at").notNull().defaultNow(),
  enrolledAt: timestamp("enrolled_at"),
  enrollmentCode: varchar("enrollment_code").unique(), // Code for vendor self-enrollment
  
  // Categories this vendor is enrolled for
  enrolledCategories: text("enrolled_categories").array(), // ["CONCRETE", "STONE", "REBAR"]
  
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  vendorIdx: index("vendor_enrollments_vendor_idx").on(table.vendorCrmOrgId),
  contractorIdx: index("vendor_enrollments_contractor_idx").on(table.contractorOrgId),
  statusIdx: index("vendor_enrollments_status_idx").on(table.status),
  vendorContractorUnique: unique("vendor_enrollments_unique").on(table.vendorCrmOrgId, table.contractorOrgId),
}));

export const insertVendorEnrollmentSchema = createInsertSchema(vendorEnrollments).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertVendorEnrollment = z.infer<typeof insertVendorEnrollmentSchema>;
export type VendorEnrollment = typeof vendorEnrollments.$inferSelect;

// Vendor Users - Links CRM organizations (vendors) to user accounts for portal access
export const vendorUsers = pgTable("vendor_users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  crmOrganisationId: varchar("crm_organisation_id").notNull().references(() => crmOrganisations.id, { onDelete: "cascade" }),
  
  // Vendor portal permissions
  canSubmitPricing: boolean("can_submit_pricing").notNull().default(true),
  canViewEnrollments: boolean("can_view_enrollments").notNull().default(true),
  canManageUsers: boolean("can_manage_users").notNull().default(false),
  isPrimaryContact: boolean("is_primary_contact").notNull().default(false),
  
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  userIdx: index("vendor_users_user_idx").on(table.userId),
  crmOrgIdx: index("vendor_users_crm_org_idx").on(table.crmOrganisationId),
  userCrmOrgUnique: unique("vendor_users_unique").on(table.userId, table.crmOrganisationId),
}));

export const insertVendorUserSchema = createInsertSchema(vendorUsers).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertVendorUser = z.infer<typeof insertVendorUserSchema>;
export type VendorUser = typeof vendorUsers.$inferSelect;

// Trade Templates - Pre-built configurations for different trades
export const tradeTemplates = pgTable("trade_templates", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tradeType: tradeTypeEnum("trade_type").notNull().unique(),
  displayName: text("display_name").notNull(),
  description: text("description"),
  csiDivision: text("csi_division"),              // CSI code (e.g., "03", "31", "07")
  iconName: text("icon_name"),                    // Lucide icon name
  colorHex: text("color_hex"),                    // Brand color for this trade
  materialCategories: text("material_categories").notNull(),
  workTypesJson: text("work_types_json").notNull(),
  calculatorConfigJson: text("calculator_config_json").notNull(),
  terminologyJson: text("terminology_json"),
  defaultUnitsJson: text("default_units_json"),
  enabledFeaturesJson: text("enabled_features_json"), // Features this trade unlocks
  isGcTrade: boolean("is_gc_trade").notNull().default(false), // True = GC gets this trade's features
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertTradeTemplateSchema = createInsertSchema(tradeTemplates).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertTradeTemplate = z.infer<typeof insertTradeTemplateSchema>;
export type TradeTemplate = typeof tradeTemplates.$inferSelect;

// Organization Material Calculators - Custom calculators per organization
export const organizationCalculators = pgTable("organization_calculators", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  category: text("category").notNull(),
  unit: text("unit").notNull(),
  formulaJson: text("formula_json").notNull(),
  inputFieldsJson: text("input_fields_json").notNull(),
  defaultValues: text("default_values"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  orgIdx: index("org_calculators_org_idx").on(table.organizationId),
}));

export const insertOrganizationCalculatorSchema = createInsertSchema(organizationCalculators).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertOrganizationCalculator = z.infer<typeof insertOrganizationCalculatorSchema>;
export type OrganizationCalculator = typeof organizationCalculators.$inferSelect;

// Organization Work Types - Custom work types per organization
export const organizationWorkTypes = pgTable("organization_work_types", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  category: text("category"),
  unit: text("unit").notNull(),
  defaultProductionRate: decimal("default_production_rate", { precision: 10, scale: 2 }),
  laborCostPerUnit: decimal("labor_cost_per_unit", { precision: 10, scale: 2 }),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  orgIdx: index("org_work_types_org_idx").on(table.organizationId),
}));

export const insertOrganizationWorkTypeSchema = createInsertSchema(organizationWorkTypes).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertOrganizationWorkType = z.infer<typeof insertOrganizationWorkTypeSchema>;
export type OrganizationWorkType = typeof organizationWorkTypes.$inferSelect;

// Organization SOW Items - Scope of Work items specific to each organization
export const organizationSowItems = pgTable("organization_sow_items", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  categoryName: text("category_name").notNull(),
  name: text("name").notNull(),
  code: text("code").notNull(),
  description: text("description"),
  unit: text("unit"),
  requiresDimensions: boolean("requires_dimensions").notNull().default(false),
  dimensionLabel: text("dimension_label"),
  defaultCostCode: varchar("default_cost_code", { length: 20 }),
  displayOrder: integer("display_order").notNull().default(0),
  isFromTemplate: boolean("is_from_template").notNull().default(false),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  orgIdx: index("org_sow_items_org_idx").on(table.organizationId),
  categoryIdx: index("org_sow_items_category_idx").on(table.categoryName),
  codeOrgUnique: unique("org_sow_items_code_org_unique").on(table.organizationId, table.code),
}));

export const insertOrganizationSowItemSchema = createInsertSchema(organizationSowItems).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertOrganizationSowItem = z.infer<typeof insertOrganizationSowItemSchema>;
export type OrganizationSowItem = typeof organizationSowItems.$inferSelect;

// SOW Audit Log - Track all SOW item changes for compliance
export const sowAuditLog = pgTable("sow_audit_log", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  action: sowAuditActionEnum("action").notNull(),
  sowCode: text("sow_code"),
  sowName: text("sow_name"),
  details: text("details"),
  previousTradeType: tradeTypeEnum("previous_trade_type"),
  newTradeType: tradeTypeEnum("new_trade_type"),
  itemCount: integer("item_count"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  orgIdx: index("sow_audit_log_org_idx").on(table.organizationId),
  userIdx: index("sow_audit_log_user_idx").on(table.userId),
  actionIdx: index("sow_audit_log_action_idx").on(table.action),
}));

export const insertSowAuditLogSchema = createInsertSchema(sowAuditLog).omit({ id: true, createdAt: true });
export type InsertSowAuditLog = z.infer<typeof insertSowAuditLogSchema>;
export type SowAuditLog = typeof sowAuditLog.$inferSelect;

// ============================================
// ORGANIZATION DOCUMENTS
// Company branding assets and compliance documents
// ============================================
export const organizationDocuments = pgTable("organization_documents", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  type: organizationDocumentTypeEnum("type").notNull(),
  name: text("name").notNull(),
  description: text("description"),
  fileUrl: text("file_url").notNull(),
  objectKey: text("object_key"),
  mimeType: text("mime_type"),
  fileSize: integer("file_size"),
  visibility: organizationDocumentVisibilityEnum("visibility").notNull().default("INTERNAL"),
  version: integer("version").notNull().default(1),
  uploadedById: varchar("uploaded_by_id").references(() => users.id, { onDelete: "set null" }),
  effectiveDate: date("effective_date"),
  expiresAt: date("expires_at"),
  notes: text("notes"),
  replacesDocumentId: varchar("replaces_document_id"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  orgIdx: index("org_docs_org_idx").on(table.organizationId),
  typeIdx: index("org_docs_type_idx").on(table.type),
  activeTypeOrgUnique: unique("org_docs_active_type_org_unique").on(table.organizationId, table.type, table.isActive),
}));

export const insertOrganizationDocumentSchema = createInsertSchema(organizationDocuments).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertOrganizationDocument = z.infer<typeof insertOrganizationDocumentSchema>;
export type OrganizationDocument = typeof organizationDocuments.$inferSelect;

// ============================================
// STANDARDIZED UNITS OF MEASURE (UOM)
// Platform-wide dropdown for consistency & AI tracking
// ============================================
export const unitsOfMeasure = pgTable("units_of_measure", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  code: text("code").notNull().unique(),           // SF, LF, CY, EA, etc.
  name: text("name").notNull(),                    // Square Foot, Linear Foot, etc.
  abbreviation: text("abbreviation").notNull(),   // sq ft, lin ft, cu yd
  category: text("category").notNull(),           // area, length, volume, quantity, time, weight, capacity
  description: text("description"),
  conversionFactor: decimal("conversion_factor", { precision: 12, scale: 6 }), // For unit conversions
  baseUnit: text("base_unit"),                    // Reference to base unit code for conversions
  sortOrder: integer("sort_order").notNull().default(0),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertUnitOfMeasureSchema = createInsertSchema(unitsOfMeasure).omit({ id: true, createdAt: true });
export type InsertUnitOfMeasure = z.infer<typeof insertUnitOfMeasureSchema>;
export type UnitOfMeasure = typeof unitsOfMeasure.$inferSelect;

// ============================================
// MASTER SOW ITEMS (Template Library)
// Pre-built scope of work items by trade for onboarding
// ============================================
export const masterSowItems = pgTable("master_sow_items", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tradeType: tradeTypeEnum("trade_type").notNull(),
  csiCode: text("csi_code"),                      // CSI division code (e.g., "03", "31 20")
  categoryName: text("category_name").notNull(),   // Grouping category
  name: text("name").notNull(),                    // SOW item name
  code: text("code").notNull(),                    // Short code for the item
  description: text("description"),
  defaultUomCode: text("default_uom_code"),        // References unitsOfMeasure.code
  requiresDimensions: boolean("requires_dimensions").notNull().default(false),
  dimensionLabel: text("dimension_label"),         // e.g., "Area (SF)", "Length (LF)"
  laborRateMultiplier: decimal("labor_rate_multiplier", { precision: 6, scale: 2 }), // For estimating
  materialWasteFactor: decimal("material_waste_factor", { precision: 5, scale: 2 }), // e.g., 1.10 for 10% waste
  sortOrder: integer("sort_order").notNull().default(0),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  tradeIdx: index("master_sow_trade_idx").on(table.tradeType),
  csiIdx: index("master_sow_csi_idx").on(table.csiCode),
  codeUnique: unique("master_sow_code_trade_unique").on(table.tradeType, table.code),
}));

export const insertMasterSowItemSchema = createInsertSchema(masterSowItems).omit({ id: true, createdAt: true });
export type InsertMasterSowItem = z.infer<typeof insertMasterSowItemSchema>;
export type MasterSowItem = typeof masterSowItems.$inferSelect;

// ============================================
// MASTER CALCULATORS (Template Library)
// Pre-built material calculators by trade
// ============================================
export const masterCalculators = pgTable("master_calculators", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tradeType: tradeTypeEnum("trade_type").notNull(),
  name: text("name").notNull(),                    // e.g., "Concrete Volume Calculator"
  category: text("category").notNull(),            // e.g., "Foundations", "Slabs"
  description: text("description"),
  outputUomCode: text("output_uom_code").notNull(), // Output unit (CY, SF, etc.)
  formulaJson: text("formula_json").notNull(),     // Calculation formula
  inputFieldsJson: text("input_fields_json").notNull(), // Input field definitions
  defaultValuesJson: text("default_values_json"),  // Default input values
  helpText: text("help_text"),                     // Usage instructions
  sortOrder: integer("sort_order").notNull().default(0),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  tradeIdx: index("master_calc_trade_idx").on(table.tradeType),
}));

export const insertMasterCalculatorSchema = createInsertSchema(masterCalculators).omit({ id: true, createdAt: true });
export type InsertMasterCalculator = z.infer<typeof insertMasterCalculatorSchema>;
export type MasterCalculator = typeof masterCalculators.$inferSelect;

// ============================================
// MASTER INSPECTION FORMS (Template Library)
// Trade-specific inspection/documentation requirements
// ============================================
export const masterInspectionForms = pgTable("master_inspection_forms", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tradeType: tradeTypeEnum("trade_type").notNull(),
  name: text("name").notNull(),                    // e.g., "Pre-Pour Inspection Checklist"
  category: text("category").notNull(),            // e.g., "Quality Control", "Safety"
  description: text("description"),
  formFieldsJson: text("form_fields_json").notNull(), // Form field definitions
  requiresPhotos: boolean("requires_photos").notNull().default(false),
  requiresSignature: boolean("requires_signature").notNull().default(false),
  regulatoryReference: text("regulatory_reference"), // e.g., "NFPA 13", "ADA"
  sortOrder: integer("sort_order").notNull().default(0),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  tradeIdx: index("master_forms_trade_idx").on(table.tradeType),
}));

export const insertMasterInspectionFormSchema = createInsertSchema(masterInspectionForms).omit({ id: true, createdAt: true });
export type InsertMasterInspectionForm = z.infer<typeof insertMasterInspectionFormSchema>;
export type MasterInspectionForm = typeof masterInspectionForms.$inferSelect;

// ============================================
// TRADE FEATURES - Define what features each trade enables
// For dynamic UI generation
// ============================================
export const tradeFeatures = pgTable("trade_features", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tradeType: tradeTypeEnum("trade_type").notNull(),
  featureKey: text("feature_key").notNull(),       // e.g., "equipment_tracking", "weather_scheduling"
  featureName: text("feature_name").notNull(),     // Display name
  description: text("description"),
  navSection: text("nav_section"),                 // Where in nav this appears
  navIcon: text("nav_icon"),                       // Lucide icon name
  navPath: text("nav_path"),                       // Route path
  dashboardWidget: text("dashboard_widget"),       // Widget component name
  sortOrder: integer("sort_order").notNull().default(0),
  isEnabled: boolean("is_enabled").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  tradeIdx: index("trade_features_trade_idx").on(table.tradeType),
  featureKeyUnique: unique("trade_features_key_unique").on(table.tradeType, table.featureKey),
}));

export const insertTradeFeatureSchema = createInsertSchema(tradeFeatures).omit({ id: true, createdAt: true });
export type InsertTradeFeature = z.infer<typeof insertTradeFeatureSchema>;
export type TradeFeature = typeof tradeFeatures.$inferSelect;

// ============================================
// FEATURE A: AI AUTO-TAKEOFF ANALYSES
// AI-powered blueprint/photo analysis for quantity takeoffs
// ============================================
export const aiTakeoffAnalyses = pgTable("ai_takeoff_analyses", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  projectId: varchar("project_id").references(() => projects.id, { onDelete: "cascade" }),
  bidId: varchar("bid_id"),
  takeoffSheetId: varchar("takeoff_sheet_id").references(() => takeoffSheets.id, { onDelete: "set null" }),
  tradeType: tradeTypeEnum("trade_type").notNull(),
  status: aiTakeoffStatusEnum("status").notNull().default("PENDING"),
  analysisMode: aiTakeoffModeEnum("analysis_mode").notNull().default("QUICK"),
  fileKey: text("file_key"),
  fileName: text("file_name"),
  detectedItemsJson: text("detected_items_json"),     // AI-detected measurements
  metadataJson: text("metadata_json"),                // Scale, title block, etc.
  aiNotes: text("ai_notes"),
  errorMessage: text("error_message"),
  processingTimeMs: integer("processing_time_ms"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  createdByUserId: varchar("created_by_user_id").references(() => users.id),
}, (table) => ({
  projectIdx: index("ai_takeoff_project_idx").on(table.projectId),
  orgIdx: index("ai_takeoff_org_idx").on(table.organizationId),
}));

export const insertAiTakeoffAnalysisSchema = createInsertSchema(aiTakeoffAnalyses).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertAiTakeoffAnalysis = z.infer<typeof insertAiTakeoffAnalysisSchema>;
export type AiTakeoffAnalysis = typeof aiTakeoffAnalyses.$inferSelect;

// ============================================
// FEATURE B: PROJECT SCHEDULES
// AI-powered scheduling with Gantt-style task management
// ============================================
export const projectSchedules = pgTable("project_schedules", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  name: text("name").notNull().default("Master Schedule"),
  generatedBy: scheduleGeneratedByEnum("generated_by").notNull().default("MANUAL"),
  baselineStartDate: date("baseline_start_date"),
  baselineEndDate: date("baseline_end_date"),
  actualStartDate: date("actual_start_date"),
  actualEndDate: date("actual_end_date"),
  workingDays: integer("working_days").array().default(sql`'{1,2,3,4,5}'`),
  optionsJson: text("options_json"),
  aiNotes: text("ai_notes"),
  version: integer("version").notNull().default(1),
  isActive: boolean("is_active").notNull().default(true),
  baselineLocked: boolean("baseline_locked").notNull().default(false),
  baselineLockedAt: timestamp("baseline_locked_at"),
  projectedCompletionDate: date("projected_completion_date"),
  spiValue: decimal("spi_value", { precision: 5, scale: 3 }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  createdByUserId: varchar("created_by_user_id").references(() => users.id),
}, (table) => ({
  projectIdx: index("project_schedules_project_idx").on(table.projectId),
  orgIdx: index("project_schedules_org_idx").on(table.organizationId),
}));

export const insertProjectScheduleSchema = createInsertSchema(projectSchedules).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertProjectSchedule = z.infer<typeof insertProjectScheduleSchema>;
export type ProjectSchedule = typeof projectSchedules.$inferSelect;

export const projectScheduleTasks = pgTable("project_schedule_tasks", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  scheduleId: varchar("schedule_id").notNull().references(() => projectSchedules.id, { onDelete: "cascade" }),
  parentTaskId: varchar("parent_task_id").references((): any => projectScheduleTasks.id, { onDelete: "set null" }),
  name: text("name").notNull(),
  description: text("description"),
  tradeType: tradeTypeEnum("trade_type"),
  plannedStartDate: date("planned_start_date"),
  plannedEndDate: date("planned_end_date"),
  actualStartDate: date("actual_start_date"),
  actualEndDate: date("actual_end_date"),
  durationDays: integer("duration_days"),
  dependencies: varchar("dependencies").array(),
  percentComplete: integer("percent_complete").notNull().default(0),
  isCriticalPath: boolean("is_critical_path").notNull().default(false),
  isMilestone: boolean("is_milestone").notNull().default(false),
  crewId: varchar("crew_id").references(() => crews.id),
  sowItemIds: varchar("sow_item_ids").array(),
  inspectionId: varchar("inspection_id").references(() => projectInspections.id),
  delayIds: varchar("delay_ids").array(),
  status: scheduleTaskStatusEnum("status").notNull().default("NOT_STARTED"),
  sortOrder: integer("sort_order").notNull().default(0),
  earlyStart: date("early_start"),
  earlyFinish: date("early_finish"),
  lateStart: date("late_start"),
  lateFinish: date("late_finish"),
  totalFloat: integer("total_float"),
  freeFloat: integer("free_float"),
  baselineStartDate: date("baseline_start_date"),
  baselineEndDate: date("baseline_end_date"),
  crewIds: varchar("crew_ids").array(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  scheduleIdx: index("schedule_tasks_schedule_idx").on(table.scheduleId),
  parentIdx: index("schedule_tasks_parent_idx").on(table.parentTaskId),
}));

export const insertProjectScheduleTaskSchema = createInsertSchema(projectScheduleTasks).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertProjectScheduleTask = z.infer<typeof insertProjectScheduleTaskSchema>;
export type ProjectScheduleTask = typeof projectScheduleTasks.$inferSelect;

export const scheduleForecastSnapshots = pgTable("schedule_forecast_snapshots", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  scheduleId: varchar("schedule_id").notNull().references(() => projectSchedules.id, { onDelete: "cascade" }),
  snapshotDate: date("snapshot_date").notNull(),
  projectedCompletionDate: date("projected_completion_date"),
  spiValue: decimal("spi_value", { precision: 5, scale: 3 }),
  baselineEndDate: date("baseline_end_date"),
  currentEndDate: date("current_end_date"),
  criticalPathDaysRemaining: integer("critical_path_days_remaining"),
  overallProgress: integer("overall_progress"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  scheduleIdx: index("forecast_snapshots_schedule_idx").on(table.scheduleId),
  dateIdx: index("forecast_snapshots_date_idx").on(table.snapshotDate),
}));

export const insertScheduleForecastSnapshotSchema = createInsertSchema(scheduleForecastSnapshots).omit({ id: true, createdAt: true });
export type InsertScheduleForecastSnapshot = z.infer<typeof insertScheduleForecastSnapshotSchema>;
export type ScheduleForecastSnapshot = typeof scheduleForecastSnapshots.$inferSelect;

// ============================================
// FEATURE C: AI JOBSITE CAMERA ANALYSIS
// Vision AI for safety, progress, and compliance analysis
// ============================================
export const jobsiteAnalysisBatches = pgTable("jobsite_analysis_batches", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  analysisDate: date("analysis_date").notNull(),
  tradeType: tradeTypeEnum("trade_type"),
  status: jobsiteAnalysisStatusEnum("status").notNull().default("PENDING"),
  analysisTypes: text("analysis_types").array().default(sql`'{SAFETY,PROGRESS}'`),
  summaryJson: text("summary_json"),                  // Overall scores and summary
  safetyFindingsJson: text("safety_findings_json"),   // Safety issues detected
  progressFindingsJson: text("progress_findings_json"), // Progress observations
  materialFindingsJson: text("material_findings_json"), // Material tracking
  crewFindingsJson: text("crew_findings_json"),       // Crew count/PPE
  aiNotes: text("ai_notes"),
  errorMessage: text("error_message"),
  processingTimeMs: integer("processing_time_ms"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  createdByUserId: varchar("created_by_user_id").references(() => users.id),
}, (table) => ({
  projectIdx: index("jobsite_analysis_project_idx").on(table.projectId),
  dateIdx: index("jobsite_analysis_date_idx").on(table.analysisDate),
}));

export const insertJobsiteAnalysisBatchSchema = createInsertSchema(jobsiteAnalysisBatches).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertJobsiteAnalysisBatch = z.infer<typeof insertJobsiteAnalysisBatchSchema>;
export type JobsiteAnalysisBatch = typeof jobsiteAnalysisBatches.$inferSelect;

export const jobsiteAnalysisPhotos = pgTable("jobsite_analysis_photos", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  batchId: varchar("batch_id").notNull().references(() => jobsiteAnalysisBatches.id, { onDelete: "cascade" }),
  fileKey: text("file_key").notNull(),
  fileUrl: text("file_url").notNull(),
  thumbnailUrl: text("thumbnail_url"),
  originalFilename: text("original_filename"),
  capturedAt: timestamp("captured_at"),
  gpsLatitude: decimal("gps_latitude", { precision: 10, scale: 8 }),
  gpsLongitude: decimal("gps_longitude", { precision: 11, scale: 8 }),
  aiAnnotationsJson: text("ai_annotations_json"),     // Per-photo AI findings
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  batchIdx: index("jobsite_photos_batch_idx").on(table.batchId),
}));

export const insertJobsiteAnalysisPhotoSchema = createInsertSchema(jobsiteAnalysisPhotos).omit({ id: true, createdAt: true });
export type InsertJobsiteAnalysisPhoto = z.infer<typeof insertJobsiteAnalysisPhotoSchema>;
export type JobsiteAnalysisPhoto = typeof jobsiteAnalysisPhotos.$inferSelect;

// ============================================
// FEATURE D: VENDOR PRICING SYNC
// Pricebook import and material pricing management
// ============================================
export const vendorPricebooks = pgTable("vendor_pricebooks", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  vendorId: varchar("vendor_id").notNull().references(() => crmOrganisations.id, { onDelete: "cascade" }),
  fileKey: text("file_key").notNull(),
  fileName: text("file_name"),
  fileType: text("file_type").notNull(),              // CSV, XLSX
  effectiveDate: date("effective_date"),
  expirationDate: date("expiration_date"),
  tradeType: tradeTypeEnum("trade_type"),
  mappingPresetJson: text("mapping_preset_json"),     // Saved column mappings
  status: pricebookStatusEnum("status").notNull().default("PENDING"),
  itemCount: integer("item_count").notNull().default(0),
  importedAt: timestamp("imported_at"),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  uploadedByUserId: varchar("uploaded_by_user_id").references(() => users.id),
}, (table) => ({
  vendorIdx: index("pricebooks_vendor_idx").on(table.vendorId),
  orgIdx: index("pricebooks_org_idx").on(table.organizationId),
}));

export const insertVendorPricebookSchema = createInsertSchema(vendorPricebooks).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertVendorPricebook = z.infer<typeof insertVendorPricebookSchema>;
export type VendorPricebook = typeof vendorPricebooks.$inferSelect;

export const vendorPricebookItems = pgTable("vendor_pricebook_items", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  pricebookId: varchar("pricebook_id").notNull().references(() => vendorPricebooks.id, { onDelete: "cascade" }),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  vendorId: varchar("vendor_id").notNull().references(() => crmOrganisations.id),
  vendorCode: text("vendor_code").notNull(),
  vendorDescription: text("vendor_description").notNull(),
  vendorUnit: text("vendor_unit"),
  category: text("category").notNull(),
  unit: text("unit").notNull(),                       // Standardized UOM
  unitPrice: decimal("unit_price", { precision: 12, scale: 4 }).notNull(),
  markupPercent: decimal("markup_percent", { precision: 5, scale: 2 }).default("0"),
  sowItemId: varchar("sow_item_id").references(() => organizationSowItems.id),
  calculatorKey: text("calculator_key"),
  isActive: boolean("is_active").notNull().default(true),
  effectiveDate: date("effective_date"),
  expirationDate: date("expiration_date"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  pricebookIdx: index("pricebook_items_pricebook_idx").on(table.pricebookId),
  vendorIdx: index("pricebook_items_vendor_idx").on(table.vendorId),
  categoryIdx: index("pricebook_items_category_idx").on(table.category),
}));

export const insertVendorPricebookItemSchema = createInsertSchema(vendorPricebookItems).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertVendorPricebookItem = z.infer<typeof insertVendorPricebookItemSchema>;
export type VendorPricebookItem = typeof vendorPricebookItems.$inferSelect;

export const vendorPriceHistory = pgTable("vendor_price_history", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  pricebookItemId: varchar("pricebook_item_id").notNull().references(() => vendorPricebookItems.id, { onDelete: "cascade" }),
  oldPrice: decimal("old_price", { precision: 12, scale: 4 }),
  newPrice: decimal("new_price", { precision: 12, scale: 4 }).notNull(),
  changePercent: decimal("change_percent", { precision: 6, scale: 2 }),
  effectiveDate: date("effective_date").notNull(),
  recordedAt: timestamp("recorded_at").notNull().defaultNow(),
}, (table) => ({
  itemIdx: index("price_history_item_idx").on(table.pricebookItemId),
}));

export const insertVendorPriceHistorySchema = createInsertSchema(vendorPriceHistory).omit({ id: true, recordedAt: true });
export type InsertVendorPriceHistory = z.infer<typeof insertVendorPriceHistorySchema>;
export type VendorPriceHistory = typeof vendorPriceHistory.$inferSelect;

// ============================================
// FEATURE E: CLIENT PORTAL
// Secure read-only project access for clients/owners
// ============================================
export const clientPortalAccess = pgTable("client_portal_access", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  email: text("email").notNull(),
  name: text("name"),
  accessType: text("access_type").notNull().default("STAKEHOLDER"),
  permissionsJson: text("permissions_json"),
  accessTokenHash: text("access_token_hash"),
  tokenExpiresAt: timestamp("token_expires_at"),
  lastAccessedAt: timestamp("last_accessed_at"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  createdByUserId: varchar("created_by_user_id").references(() => users.id),
}, (table) => ({
  projectIdx: index("portal_access_project_idx").on(table.projectId),
  emailIdx: index("portal_access_email_idx").on(table.email),
}));

export const insertClientPortalAccessSchema = createInsertSchema(clientPortalAccess).omit({ id: true, createdAt: true });
export type InsertClientPortalAccess = z.infer<typeof insertClientPortalAccessSchema>;
export type ClientPortalAccess = typeof clientPortalAccess.$inferSelect;

export const clientPortalActivity = pgTable("client_portal_activity", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  accessId: varchar("access_id").notNull().references(() => clientPortalAccess.id, { onDelete: "cascade" }),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  action: text("action").notNull(),                   // VIEW_SUMMARY, VIEW_PHOTOS, APPROVE_CO, etc.
  detailsJson: text("details_json"),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  accessIdx: index("portal_activity_access_idx").on(table.accessId),
  projectIdx: index("portal_activity_project_idx").on(table.projectId),
}));

export const insertClientPortalActivitySchema = createInsertSchema(clientPortalActivity).omit({ id: true, createdAt: true });
export type InsertClientPortalActivity = z.infer<typeof insertClientPortalActivitySchema>;
export type ClientPortalActivity = typeof clientPortalActivity.$inferSelect;

// ============================================
// FEATURE F: AI CHANGE ORDER DRAFTS
// AI-generated change order content before finalization
// ============================================
export const aiCoDrafts = pgTable("ai_co_drafts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  tradeType: tradeTypeEnum("trade_type"),
  linkedItemsJson: text("linked_items_json"),         // Delay IDs, inspection IDs, etc.
  draftContentJson: text("draft_content_json").notNull(), // Title, description, scope, etc.
  pricingJson: text("pricing_json"),                  // Line items with pricing
  aiConfidence: integer("ai_confidence"),
  aiNotes: text("ai_notes"),
  status: aiCoDraftStatusEnum("status").notNull().default("DRAFT"),
  convertedToCoId: varchar("converted_to_co_id").references(() => changeOrders.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  createdByUserId: varchar("created_by_user_id").references(() => users.id),
}, (table) => ({
  projectIdx: index("ai_co_drafts_project_idx").on(table.projectId),
  orgIdx: index("ai_co_drafts_org_idx").on(table.organizationId),
}));

export const insertAiCoDraftSchema = createInsertSchema(aiCoDrafts).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertAiCoDraft = z.infer<typeof insertAiCoDraftSchema>;
export type AiCoDraft = typeof aiCoDrafts.$inferSelect;

// ============================================
// FEATURE G: MOBILE DEVICES & SYNC
// Device registration and offline sync support
// ============================================
export const mobileDevices = pgTable("mobile_devices", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  deviceId: text("device_id").notNull().unique(),
  platform: mobilePlatformEnum("platform").notNull(),
  appVersion: text("app_version"),
  deviceModel: text("device_model"),
  pushToken: text("push_token"),
  lastSyncAt: timestamp("last_sync_at"),
  syncToken: text("sync_token"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  userIdx: index("mobile_devices_user_idx").on(table.userId),
  orgIdx: index("mobile_devices_org_idx").on(table.organizationId),
}));

export const insertMobileDeviceSchema = createInsertSchema(mobileDevices).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertMobileDevice = z.infer<typeof insertMobileDeviceSchema>;
export type MobileDevice = typeof mobileDevices.$inferSelect;

export const mobileSyncLog = pgTable("mobile_sync_log", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  deviceId: varchar("device_id").notNull().references(() => mobileDevices.id, { onDelete: "cascade" }),
  syncType: text("sync_type").notNull(),              // PULL, PUSH, FULL
  syncStartedAt: timestamp("sync_started_at").notNull(),
  syncCompletedAt: timestamp("sync_completed_at"),
  recordsDownloaded: integer("records_downloaded").notNull().default(0),
  recordsUploaded: integer("records_uploaded").notNull().default(0),
  conflicts: integer("conflicts").notNull().default(0),
  status: syncStatusEnum("status").notNull().default("IN_PROGRESS"),
  errorMessage: text("error_message"),
  metadataJson: text("metadata_json"),
}, (table) => ({
  deviceIdx: index("sync_log_device_idx").on(table.deviceId),
}));

export const insertMobileSyncLogSchema = createInsertSchema(mobileSyncLog).omit({ id: true });
export type InsertMobileSyncLog = z.infer<typeof insertMobileSyncLogSchema>;
export type MobileSyncLog = typeof mobileSyncLog.$inferSelect;

export const mobilePendingUploads = pgTable("mobile_pending_uploads", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  deviceId: varchar("device_id").notNull().references(() => mobileDevices.id, { onDelete: "cascade" }),
  localId: text("local_id").notNull(),
  recordType: text("record_type").notNull(),
  recordDataJson: text("record_data_json").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  processedAt: timestamp("processed_at"),
  status: text("status").notNull().default("PENDING"),
  errorMessage: text("error_message"),
}, (table) => ({
  deviceIdx: index("pending_uploads_device_idx").on(table.deviceId),
}));

export const insertMobilePendingUploadSchema = createInsertSchema(mobilePendingUploads).omit({ id: true, createdAt: true });
export type InsertMobilePendingUpload = z.infer<typeof insertMobilePendingUploadSchema>;
export type MobilePendingUpload = typeof mobilePendingUploads.$inferSelect;

// ============================================
// SCHEDULE OF VALUES (SOV) SYSTEM
// Progress billing and value tracking
// ============================================
export const scheduleOfValues = pgTable("schedule_of_values", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  
  // SOV Header Info
  sovNumber: text("sov_number").notNull(), // e.g., "SOV-001"
  title: text("title").notNull(),
  description: text("description"),
  contractValue: decimal("contract_value", { precision: 14, scale: 2 }).notNull(),
  retainagePercent: decimal("retainage_percent", { precision: 5, scale: 2 }).default("10"),
  
  // Billing Period
  periodNumber: integer("period_number").notNull().default(1),
  periodStart: date("period_start"),
  periodEnd: date("period_end"),
  
  // Status & Tracking
  status: sovStatusEnum("status").notNull().default("DRAFT"),
  approvedById: varchar("approved_by_id").references(() => users.id),
  approvedAt: timestamp("approved_at"),
  submittedAt: timestamp("submitted_at"),
  paidAt: timestamp("paid_at"),
  
  // Totals (calculated)
  totalScheduledValue: decimal("total_scheduled_value", { precision: 14, scale: 2 }),
  totalPreviouslyCompleted: decimal("total_previously_completed", { precision: 14, scale: 2 }),
  totalThisPeriod: decimal("total_this_period", { precision: 14, scale: 2 }),
  totalCompletedToDate: decimal("total_completed_to_date", { precision: 14, scale: 2 }),
  totalMaterialsStored: decimal("total_materials_stored", { precision: 14, scale: 2 }),
  totalRetainage: decimal("total_retainage", { precision: 14, scale: 2 }),
  totalEarnedLessRetainage: decimal("total_earned_less_retainage", { precision: 14, scale: 2 }),
  
  // Generated PDF URL
  pdfUrl: text("pdf_url"),
  pdfGeneratedAt: timestamp("pdf_generated_at"),
  
  createdById: varchar("created_by_id").references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  projectIdx: index("sov_project_idx").on(table.projectId),
  orgIdx: index("sov_org_idx").on(table.organizationId),
  statusIdx: index("sov_status_idx").on(table.status),
}));

export const insertScheduleOfValuesSchema = createInsertSchema(scheduleOfValues).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertScheduleOfValues = z.infer<typeof insertScheduleOfValuesSchema>;
export type ScheduleOfValues = typeof scheduleOfValues.$inferSelect;

export const sovLineItems = pgTable("sov_line_items", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  sovId: varchar("sov_id").notNull().references(() => scheduleOfValues.id, { onDelete: "cascade" }),
  
  // Line Item Details
  lineNumber: integer("line_number").notNull(),
  itemCode: text("item_code"), // e.g., "01.A", "02.B"
  description: text("description").notNull(),
  category: text("category"), // Labor, Material, Equipment, Subcontract
  
  // Values
  scheduledValue: decimal("scheduled_value", { precision: 12, scale: 2 }).notNull(),
  previouslyCompleted: decimal("previously_completed", { precision: 12, scale: 2 }).default("0"),
  thisPeriodCompleted: decimal("this_period_completed", { precision: 12, scale: 2 }).default("0"),
  materialsStored: decimal("materials_stored", { precision: 12, scale: 2 }).default("0"),
  
  // Calculated Fields
  totalCompletedAndStored: decimal("total_completed_and_stored", { precision: 12, scale: 2 }),
  percentComplete: decimal("percent_complete", { precision: 5, scale: 2 }),
  balanceToFinish: decimal("balance_to_finish", { precision: 12, scale: 2 }),
  retainageAmount: decimal("retainage_amount", { precision: 12, scale: 2 }),
  
  // Reference to estimate line item (if applicable)
  estimateLineItemId: varchar("estimate_line_item_id").references(() => estimateLineItems.id, { onDelete: "set null" }),
  
  // Reference to change order (when line item was added from an approved CO)
  linkedChangeOrderId: varchar("linked_change_order_id").references(() => changeOrders.id, { onDelete: "set null" }),
  
  // Unified SOW Tracking - links to organization's master SOW library for billing analytics across projects
  organizationSowItemId: varchar("organization_sow_item_id").references(() => organizationSowItems.id, { onDelete: "set null" }),

  // DOT pay item linking — carries through to DOT progress estimate format
  dotPayItemId: varchar("dot_pay_item_id"),
  payItemNumber: varchar("pay_item_number", { length: 64 }),
  specSection: varchar("spec_section", { length: 32 }),

  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  sovIdx: index("sov_line_items_sov_idx").on(table.sovId),
  organizationSowItemIdx: index("sov_line_items_org_sow_item_idx").on(table.organizationSowItemId),
  dotPayItemIdx: index("sov_line_items_dot_pay_item_idx").on(table.dotPayItemId),
}));

export const insertSovLineItemSchema = createInsertSchema(sovLineItems).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertSovLineItem = z.infer<typeof insertSovLineItemSchema>;
export type SovLineItem = typeof sovLineItems.$inferSelect;

// ============================================
// LIEN WAIVERS
// Track conditional/unconditional lien waivers tied to SOV pay apps
// ============================================
export const lienWaivers = pgTable("lien_waivers", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  sovId: varchar("sov_id").references(() => scheduleOfValues.id, { onDelete: "set null" }),
  waiverType: lienWaiverTypeEnum("waiver_type").notNull(),
  status: lienWaiverStatusEnum("status").notNull().default("PENDING"),
  recipientName: text("recipient_name").notNull(),
  recipientCompany: text("recipient_company"),
  throughDate: date("through_date").notNull(),
  amount: decimal("amount", { precision: 14, scale: 2 }).notNull(),
  notes: text("notes"),
  documentUrl: text("document_url"),
  sentAt: timestamp("sent_at"),
  receivedAt: timestamp("received_at"),
  approvedById: varchar("approved_by_id").references(() => users.id),
  approvedAt: timestamp("approved_at"),
  createdById: varchar("created_by_id").references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  projectIdx: index("lien_waivers_project_idx").on(table.projectId),
  orgIdx: index("lien_waivers_org_idx").on(table.organizationId),
  sovIdx: index("lien_waivers_sov_idx").on(table.sovId),
}));

export const insertLienWaiverSchema = createInsertSchema(lienWaivers).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertLienWaiver = z.infer<typeof insertLienWaiverSchema>;
export type LienWaiver = typeof lienWaivers.$inferSelect;

// ============================================
// SOV PAYMENTS
// Track partial and full payments against SOV pay apps
// ============================================
export const sovPayments = pgTable("sov_payments", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  sovId: varchar("sov_id").notNull().references(() => scheduleOfValues.id, { onDelete: "cascade" }),
  paymentNumber: integer("payment_number").notNull().default(1),
  amount: decimal("amount", { precision: 14, scale: 2 }).notNull(),
  paymentDate: date("payment_date").notNull(),
  paymentMethod: sovPaymentMethodEnum("payment_method").default("CHECK"),
  referenceNumber: text("reference_number"),
  notes: text("notes"),
  recordedById: varchar("recorded_by_id").references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  sovIdx: index("sov_payments_sov_idx").on(table.sovId),
  orgIdx: index("sov_payments_org_idx").on(table.organizationId),
}));

export const insertSovPaymentSchema = createInsertSchema(sovPayments).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertSovPayment = z.infer<typeof insertSovPaymentSchema>;
export type SovPayment = typeof sovPayments.$inferSelect;

// ============================================
// AIA PAY APPLICATIONS (G702 Header)
// Track AIA G702 Application & Certificate for Payment data
// ============================================
export const payApplications = pgTable("pay_applications", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  sovId: varchar("sov_id").notNull().references(() => scheduleOfValues.id, { onDelete: "cascade" }),

  applicationNumber: integer("application_number").notNull(),
  periodTo: date("period_to"),

  architectName: text("architect_name"),
  architectAddress: text("architect_address"),
  ownerName: text("owner_name"),
  ownerAddress: text("owner_address"),
  contractorName: text("contractor_name"),
  contractorAddress: text("contractor_address"),
  contractDate: date("contract_date"),
  contractFor: text("contract_for"),

  originalContractSum: decimal("original_contract_sum", { precision: 14, scale: 2 }),
  netChangeByChangeOrders: decimal("net_change_by_change_orders", { precision: 14, scale: 2 }),
  contractSumToDate: decimal("contract_sum_to_date", { precision: 14, scale: 2 }),
  totalCompletedAndStored: decimal("total_completed_and_stored", { precision: 14, scale: 2 }),
  retainagePercent: decimal("retainage_percent", { precision: 5, scale: 2 }),
  totalRetained: decimal("total_retained", { precision: 14, scale: 2 }),
  totalEarnedLessRetainage: decimal("total_earned_less_retainage", { precision: 14, scale: 2 }),
  lessPreviousCertificates: decimal("less_previous_certificates", { precision: 14, scale: 2 }),
  currentPaymentDue: decimal("current_payment_due", { precision: 14, scale: 2 }),
  balanceToFinish: decimal("balance_to_finish", { precision: 14, scale: 2 }),

  status: sovStatusEnum("status").notNull().default("DRAFT"),
  submittedAt: timestamp("submitted_at"),
  approvedAt: timestamp("approved_at"),
  approvedById: varchar("approved_by_id").references(() => users.id),
  rejectionReason: text("rejection_reason"),

  paidAmount: decimal("paid_amount", { precision: 14, scale: 2 }).default("0"),
  paidAt: timestamp("paid_at"),
  paymentReference: text("payment_reference"),
  paymentMethod: text("payment_method"),

  createdById: varchar("created_by_id").references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  projectIdx: index("pay_app_project_idx").on(table.projectId),
  orgIdx: index("pay_app_org_idx").on(table.organizationId),
  sovIdx: index("pay_app_sov_idx").on(table.sovId),
}));

export const insertPayApplicationSchema = createInsertSchema(payApplications).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertPayApplication = z.infer<typeof insertPayApplicationSchema>;
export type PayApplication = typeof payApplications.$inferSelect;

// ============================================
// STORED MATERIALS
// Track materials stored on-site or off-site for G703 billing
// ============================================
export const storedMaterials = pgTable("stored_materials", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  sovId: varchar("sov_id").notNull().references(() => scheduleOfValues.id, { onDelete: "cascade" }),
  sovLineItemId: varchar("sov_line_item_id").references(() => sovLineItems.id, { onDelete: "set null" }),

  description: text("description").notNull(),
  storageLocation: text("storage_location"),
  storageStatus: storedMaterialStatusEnum("storage_status").notNull().default("ON_SITE"),
  deliveryDate: date("delivery_date"),
  incorporatedDate: date("incorporated_date"),
  amount: decimal("amount", { precision: 14, scale: 2 }).notNull(),
  vendor: text("vendor"),
  invoiceReference: text("invoice_reference"),
  notes: text("notes"),

  createdById: varchar("created_by_id").references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  projectIdx: index("stored_mat_project_idx").on(table.projectId),
  orgIdx: index("stored_mat_org_idx").on(table.organizationId),
  sovIdx: index("stored_mat_sov_idx").on(table.sovId),
  lineItemIdx: index("stored_mat_line_item_idx").on(table.sovLineItemId),
}));

export const insertStoredMaterialSchema = createInsertSchema(storedMaterials).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertStoredMaterial = z.infer<typeof insertStoredMaterialSchema>;
export type StoredMaterial = typeof storedMaterials.$inferSelect;

// ============================================
// RETENTION RELEASES
// Track partial and final retention releases with approval
// ============================================
export const retentionReleases = pgTable("retention_releases", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  sovId: varchar("sov_id").references(() => scheduleOfValues.id, { onDelete: "set null" }),

  releaseType: retentionReleaseTypeEnum("release_type").notNull(),
  status: retentionReleaseStatusEnum("status").notNull().default("REQUESTED"),
  amount: decimal("amount", { precision: 14, scale: 2 }).notNull(),
  reason: text("reason"),
  approvedById: varchar("approved_by_id").references(() => users.id),
  approvedAt: timestamp("approved_at"),
  releasedAt: timestamp("released_at"),

  requestedById: varchar("requested_by_id").references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  projectIdx: index("ret_release_project_idx").on(table.projectId),
  orgIdx: index("ret_release_org_idx").on(table.organizationId),
}));

export const insertRetentionReleaseSchema = createInsertSchema(retentionReleases).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertRetentionRelease = z.infer<typeof insertRetentionReleaseSchema>;
export type RetentionRelease = typeof retentionReleases.$inferSelect;

// ============================================
// WEBSITE BUILDER SYSTEM
// Complete website builder with AI design, blog, gallery, analytics
// ============================================

// Website Builder Enums
export const organizationWebsites = pgTable("organization_websites", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  
  // Site Configuration
  status: websiteStatusEnum("status").notNull().default("DRAFT"),
  siteTitle: text("site_title"),
  siteTagline: text("site_tagline"),
  missionStatement: text("mission_statement"),
  
  // Domain Settings
  subdomain: text("subdomain").unique(), // company.smartmanageai-sites.com
  customDomain: text("custom_domain"),
  customDomainVerified: boolean("custom_domain_verified").default(false),
  sslEnabled: boolean("ssl_enabled").default(true),
  stagingToken: text("staging_token"),
  
  // Theme & Branding
  primaryColor: text("primary_color"),
  secondaryColor: text("secondary_color"),
  accentColor: text("accent_color"),
  backgroundColor: text("background_color"),
  textColor: text("text_color"),
  fontFamily: text("font_family"),
  templateId: text("template_id"),
  logoUrl: text("logo_url"),
  faviconUrl: text("favicon_url"),
  logoHeight: integer("logo_height").default(55),
  
  // SEO Global Settings
  defaultMetaTitle: text("default_meta_title"),
  defaultMetaDescription: text("default_meta_description"),
  defaultKeywords: text("default_keywords").array(),
  ogImageUrl: text("og_image_url"),
  googleAnalyticsId: text("google_analytics_id"),
  
  // Contact Info (can override organization)
  contactEmail: text("contact_email"),
  contactPhone: text("contact_phone"),
  contactAddress: text("contact_address"),
  
  // Global Layout Settings
  contentWidth: text("content_width").default("full-width"),
  maxWidth: integer("max_width").default(1200),
  sectionPadding: integer("section_padding").default(24),
  breakpointDesktop: integer("breakpoint_desktop").default(1280),
  breakpointTablet: integer("breakpoint_tablet").default(768),
  breakpointMobile: integer("breakpoint_mobile").default(480),
  
  // Header Layout Settings
  headerType: text("header_type").default("static"),
  headerHeight: integer("header_height").default(80),
  logoPosition: text("logo_position").default("left"),
  navigationLayout: text("navigation_layout").default("horizontal"),
  mobileNavStyle: text("mobile_nav_style").default("dropdown"),
  showOnScroll: boolean("show_on_scroll").default(true),
  
  // Inner Page Layout Settings
  pageLayout: text("page_layout").default("boxed"),
  sidebarWidth: integer("sidebar_width").default(300),
  pagePadding: integer("page_padding").default(32),
  showBreadcrumb: boolean("show_breadcrumb").default(true),

  // Footer Layout Settings
  footerVisibility: boolean("footer_visibility").default(true),
  footerColumns: integer("footer_columns").default(3),
  footerWidth: text("footer_width").default("boxed"),
  footerPadding: integer("footer_padding").default(40),
  footerSectionSettings: json("footer_section_settings"),
  headerSectionSettings: json("header_section_settings"),

  // Component Configurations (JSON)
  headerComponentsConfig: json("header_components_config"),
  footerComponentsConfig: json("footer_components_config"),
  bodyComponentsConfig: json("body_components_config"),
  globalComponentsConfig: json("global_components_config"),
  
  // Features Toggle
  blogEnabled: boolean("blog_enabled").default(true),
  galleryEnabled: boolean("gallery_enabled").default(true),
  contactFormEnabled: boolean("contact_form_enabled").default(true),
  analyticsEnabled: boolean("analytics_enabled").default(true),
  careersEnabled: boolean("careers_enabled").default(false),
  careersIntroText: text("careers_intro_text"),
  
  // Publishing
  lastPublishedAt: timestamp("last_published_at"),
  lastPublishedByUserId: varchar("last_published_by_user_id").references(() => users.id),
  publishedBundleUrl: text("published_bundle_url"),
  
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  orgIdx: index("website_org_idx").on(table.organizationId),
  subdomainIdx: index("website_subdomain_idx").on(table.subdomain),
}));

export const insertOrganizationWebsiteSchema = createInsertSchema(organizationWebsites).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertOrganizationWebsite = z.infer<typeof insertOrganizationWebsiteSchema>;
export type OrganizationWebsite = typeof organizationWebsites.$inferSelect;

export const websiteDeployments = pgTable("website_deployments", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  websiteId: varchar("website_id").notNull().references(() => organizationWebsites.id, { onDelete: "cascade" }),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  action: websiteDeploymentActionEnum("action").notNull(),
  performedByUserId: varchar("performed_by_user_id").notNull().references(() => users.id),
  performedByName: text("performed_by_name"),
  note: text("note"),
  snapshotUrl: text("snapshot_url"),
  metadata: json("metadata"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  websiteIdx: index("deployment_website_idx").on(table.websiteId),
  orgIdx: index("deployment_org_idx").on(table.organizationId),
  createdAtIdx: index("deployment_created_at_idx").on(table.createdAt),
}));

export const insertWebsiteDeploymentSchema = createInsertSchema(websiteDeployments).omit({ id: true, createdAt: true });
export type InsertWebsiteDeployment = z.infer<typeof insertWebsiteDeploymentSchema>;
export type WebsiteDeployment = typeof websiteDeployments.$inferSelect;

// Website Pages
export const organizationWebsitePages = pgTable("organization_website_pages", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  websiteId: varchar("website_id").notNull().references(() => organizationWebsites.id, { onDelete: "cascade" }),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  
  // Page Identity
  pageType: websitePageTypeEnum("page_type").notNull().default("CUSTOM"),
  pageSlug: text("page_slug").notNull(), // e.g., "about", "services/concrete"
  pageTitle: text("page_title").notNull(),
  
  // Content
  contentJson: text("content_json"), // Block-based content structure
  heroImageUrl: text("hero_image_url"),
  aiGenerated: boolean("ai_generated").default(false),
  
  // SEO
  metaTitle: text("meta_title"),
  metaDescription: text("meta_description"),
  keywords: text("keywords").array(),
  richSchemaJson: text("rich_schema_json"), // JSON-LD structured data
  canonicalUrl: text("canonical_url"),
  noIndex: boolean("no_index").default(false),
  ogImageUrl: text("og_image_url"),
  
  // Display Settings
  isPublished: boolean("is_published").default(false),
  showInNavigation: boolean("show_in_navigation").default(true),
  navigationOrder: integer("navigation_order").default(0),
  navigationLabel: text("navigation_label"),
  parentPageId: varchar("parent_page_id"),
  
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  websiteIdx: index("website_pages_website_idx").on(table.websiteId),
  orgIdx: index("website_pages_org_idx").on(table.organizationId),
  slugIdx: index("website_pages_slug_idx").on(table.websiteId, table.pageSlug),
}));

export const insertOrganizationWebsitePageSchema = createInsertSchema(organizationWebsitePages).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertOrganizationWebsitePage = z.infer<typeof insertOrganizationWebsitePageSchema>;
export type OrganizationWebsitePage = typeof organizationWebsitePages.$inferSelect;

// Page Preview Links (shareable read-only preview)
export const pagePreviewLinks = pgTable("page_preview_links", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  pageId: varchar("page_id").notNull().references(() => organizationWebsitePages.id, { onDelete: "cascade" }),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  token: varchar("token").notNull().unique(),
  createdById: varchar("created_by_id").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  revokedAt: timestamp("revoked_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  tokenIdx: index("preview_links_token_idx").on(table.token),
  pageIdx: index("preview_links_page_idx").on(table.pageId),
}));

export const insertPagePreviewLinkSchema = createInsertSchema(pagePreviewLinks).omit({ id: true, createdAt: true });
export type InsertPagePreviewLink = z.infer<typeof insertPagePreviewLinkSchema>;
export type PagePreviewLink = typeof pagePreviewLinks.$inferSelect;

// Page Versions (version history / snapshots)
export const pageVersions = pgTable("page_versions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  pageId: varchar("page_id").notNull().references(() => organizationWebsitePages.id, { onDelete: "cascade" }),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  versionNumber: integer("version_number").notNull(),
  contentJson: text("content_json"),
  pageSettingsJson: text("page_settings_json"),
  editorId: varchar("editor_id").notNull(),
  editorName: text("editor_name").notNull(),
  changeSummary: text("change_summary"),
  trigger: text("trigger").notNull().default("manual"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  pageIdx: index("page_versions_page_idx").on(table.pageId),
  versionIdx: index("page_versions_version_idx").on(table.pageId, table.versionNumber),
}));

export const insertPageVersionSchema = createInsertSchema(pageVersions).omit({ id: true, createdAt: true });
export type InsertPageVersion = z.infer<typeof insertPageVersionSchema>;
export type PageVersion = typeof pageVersions.$inferSelect;

// Blog Posts
export const websiteBlogPosts = pgTable("website_blog_posts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  websiteId: varchar("website_id").notNull().references(() => organizationWebsites.id, { onDelete: "cascade" }),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  
  // Post Content
  slug: text("slug").notNull(),
  title: text("title").notNull(),
  excerpt: text("excerpt"),
  contentJson: text("content_json"), // Block-based editor content
  contentHtml: text("content_html"), // Rendered HTML for public display
  coverImageUrl: text("cover_image_url"),
  
  // Categorization
  category: text("category"),
  tags: text("tags").array(),
  
  // Author
  authorId: varchar("author_id").references(() => users.id),
  authorName: text("author_name"),
  
  // AI Generation
  aiGenerated: boolean("ai_generated").default(false),
  aiPrompt: text("ai_prompt"),
  
  // SEO
  metaTitle: text("meta_title"),
  metaDescription: text("meta_description"),
  keywords: text("keywords").array(),
  richSchemaJson: text("rich_schema_json"),
  
  // Status & Publishing
  status: blogPostStatusEnum("status").notNull().default("DRAFT"),
  publishedAt: timestamp("published_at"),
  featuredPost: boolean("featured_post").default(false),
  
  // Engagement
  viewCount: integer("view_count").default(0),
  shareCount: integer("share_count").default(0),
  commentsEnabled: boolean("comments_enabled").default(true),
  
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  websiteIdx: index("blog_posts_website_idx").on(table.websiteId),
  orgIdx: index("blog_posts_org_idx").on(table.organizationId),
  slugIdx: index("blog_posts_slug_idx").on(table.websiteId, table.slug),
  statusIdx: index("blog_posts_status_idx").on(table.status),
}));

export const insertWebsiteBlogPostSchema = createInsertSchema(websiteBlogPosts).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertWebsiteBlogPost = z.infer<typeof insertWebsiteBlogPostSchema>;
export type WebsiteBlogPost = typeof websiteBlogPosts.$inferSelect;

// Blog Comments
export const websiteBlogComments = pgTable("website_blog_comments", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  postId: varchar("post_id").notNull().references(() => websiteBlogPosts.id, { onDelete: "cascade" }),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  
  // Comment Content
  authorName: text("author_name").notNull(),
  authorEmail: text("author_email").notNull(),
  authorWebsite: text("author_website"),
  content: text("content").notNull(),
  
  // Moderation
  status: blogCommentStatusEnum("status").notNull().default("PENDING"),
  moderatedById: varchar("moderated_by_id").references(() => users.id),
  moderatedAt: timestamp("moderated_at"),
  
  // Replies
  parentCommentId: varchar("parent_comment_id"),
  
  // Metadata
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  postIdx: index("blog_comments_post_idx").on(table.postId),
  statusIdx: index("blog_comments_status_idx").on(table.status),
}));

export const insertWebsiteBlogCommentSchema = createInsertSchema(websiteBlogComments).omit({ id: true, createdAt: true });
export type InsertWebsiteBlogComment = z.infer<typeof insertWebsiteBlogCommentSchema>;
export type WebsiteBlogComment = typeof websiteBlogComments.$inferSelect;

// Project Gallery / Portfolio
export const websiteProjects = pgTable("website_projects", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  websiteId: varchar("website_id").notNull().references(() => organizationWebsites.id, { onDelete: "cascade" }),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  
  // Link to actual project (optional)
  linkedProjectId: varchar("linked_project_id").references(() => projects.id, { onDelete: "set null" }),
  
  // Project Details
  slug: text("slug").notNull(),
  title: text("title").notNull(),
  shortDescription: text("short_description"),
  fullDescription: text("full_description"),
  
  // Categorization
  serviceType: text("service_type"), // Matches trade/service type
  projectType: text("project_type"), // Commercial, Residential, Industrial
  location: text("location"),
  completionDate: date("completion_date"),
  
  // Media
  coverImageUrl: text("cover_image_url"),
  beforeImageUrl: text("before_image_url"),
  afterImageUrl: text("after_image_url"),
  
  // AI Content
  aiGenerated: boolean("ai_generated").default(false),
  aiPrompt: text("ai_prompt"),
  
  // SEO
  metaTitle: text("meta_title"),
  metaDescription: text("meta_description"),
  keywords: text("keywords").array(),
  richSchemaJson: text("rich_schema_json"),
  
  // Display Settings
  status: websiteProjectStatusEnum("status").notNull().default("DRAFT"),
  featured: boolean("featured").default(false),
  displayOrder: integer("display_order").default(0),
  
  // Engagement
  viewCount: integer("view_count").default(0),
  
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  websiteIdx: index("website_projects_website_idx").on(table.websiteId),
  orgIdx: index("website_projects_org_idx").on(table.organizationId),
  slugIdx: index("website_projects_slug_idx").on(table.websiteId, table.slug),
  statusIdx: index("website_projects_status_idx").on(table.status),
}));

export const insertWebsiteProjectSchema = createInsertSchema(websiteProjects).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertWebsiteProject = z.infer<typeof insertWebsiteProjectSchema>;
export type WebsiteProject = typeof websiteProjects.$inferSelect;

// Project Gallery Images
export const websiteProjectImages = pgTable("website_project_images", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: varchar("project_id").notNull().references(() => websiteProjects.id, { onDelete: "cascade" }),
  
  imageUrl: text("image_url").notNull(),
  thumbnailUrl: text("thumbnail_url"),
  altText: text("alt_text"),
  caption: text("caption"),
  displayOrder: integer("display_order").default(0),
  
  // AI-generated caption
  aiCaption: text("ai_caption"),
  
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  projectIdx: index("project_images_project_idx").on(table.projectId),
}));

export const insertWebsiteProjectImageSchema = createInsertSchema(websiteProjectImages).omit({ id: true, createdAt: true });
export type InsertWebsiteProjectImage = z.infer<typeof insertWebsiteProjectImageSchema>;
export type WebsiteProjectImage = typeof websiteProjectImages.$inferSelect;

// Website Analytics - Daily Aggregates
export const websiteAnalyticsDaily = pgTable("website_analytics_daily", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  websiteId: varchar("website_id").notNull().references(() => organizationWebsites.id, { onDelete: "cascade" }),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  
  // Date dimension
  date: date("date").notNull(),
  
  // Traffic Metrics
  pageViews: integer("page_views").default(0),
  uniqueVisitors: integer("unique_visitors").default(0),
  sessions: integer("sessions").default(0),
  avgSessionDuration: integer("avg_session_duration").default(0), // in seconds
  bounceRate: decimal("bounce_rate", { precision: 5, scale: 2 }),
  
  // Top Pages (JSON array)
  topPagesJson: text("top_pages_json"),
  
  // Traffic Sources (JSON)
  trafficSourcesJson: text("traffic_sources_json"),
  
  // Lead Metrics
  contactFormSubmissions: integer("contact_form_submissions").default(0),
  phoneClicks: integer("phone_clicks").default(0),
  emailClicks: integer("email_clicks").default(0),
  
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  websiteDateIdx: index("analytics_daily_website_date_idx").on(table.websiteId, table.date),
  orgIdx: index("analytics_daily_org_idx").on(table.organizationId),
}));

export const insertWebsiteAnalyticsDailySchema = createInsertSchema(websiteAnalyticsDaily).omit({ id: true, createdAt: true });
export type InsertWebsiteAnalyticsDaily = z.infer<typeof insertWebsiteAnalyticsDailySchema>;
export type WebsiteAnalyticsDaily = typeof websiteAnalyticsDaily.$inferSelect;

// Website Analytics - Individual Events
export const websiteAnalyticsEvents = pgTable("website_analytics_events", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  websiteId: varchar("website_id").notNull().references(() => organizationWebsites.id, { onDelete: "cascade" }),
  
  // Session Info
  sessionId: text("session_id").notNull(),
  visitorId: text("visitor_id"), // Persistent visitor identifier
  
  // Event Details
  eventType: text("event_type").notNull(), // PAGE_VIEW, CLICK, FORM_SUBMIT, etc.
  pagePath: text("page_path"),
  pageTitle: text("page_title"),
  referrer: text("referrer"),
  
  // Event Data
  eventDataJson: text("event_data_json"), // Custom event properties
  
  // Visitor Info
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  deviceType: text("device_type"), // desktop, mobile, tablet
  browser: text("browser"),
  os: text("os"),
  country: text("country"),
  city: text("city"),
  
  // UTM Parameters
  utmSource: text("utm_source"),
  utmMedium: text("utm_medium"),
  utmCampaign: text("utm_campaign"),
  
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  websiteIdx: index("analytics_events_website_idx").on(table.websiteId),
  sessionIdx: index("analytics_events_session_idx").on(table.sessionId),
  eventTypeIdx: index("analytics_events_type_idx").on(table.eventType),
  createdAtIdx: index("analytics_events_created_idx").on(table.createdAt),
}));

export const insertWebsiteAnalyticsEventSchema = createInsertSchema(websiteAnalyticsEvents).omit({ id: true, createdAt: true });
export type InsertWebsiteAnalyticsEvent = z.infer<typeof insertWebsiteAnalyticsEventSchema>;
export type WebsiteAnalyticsEvent = typeof websiteAnalyticsEvents.$inferSelect;

// Social Media Links
export const organizationSocialLinks = pgTable("organization_social_links", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }).unique(),
  
  facebookUrl: text("facebook_url"),
  instagramUrl: text("instagram_url"),
  linkedinUrl: text("linkedin_url"),
  twitterUrl: text("twitter_url"),
  tiktokUrl: text("tiktok_url"),
  youtubeUrl: text("youtube_url"),
  
  // Display Settings
  showOnWebsite: boolean("show_on_website").default(true),
  showInFooter: boolean("show_in_footer").default(true),
  showOnContact: boolean("show_on_contact").default(true),
  
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  orgIdx: index("social_links_org_idx").on(table.organizationId),
}));

export const insertOrganizationSocialLinksSchema = createInsertSchema(organizationSocialLinks).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertOrganizationSocialLinks = z.infer<typeof insertOrganizationSocialLinksSchema>;
export type OrganizationSocialLinks = typeof organizationSocialLinks.$inferSelect;

// AI Social Post History
export const socialPostHistory = pgTable("social_post_history", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  
  // Platform & Content
  platform: socialPlatformEnum("platform").notNull(),
  postContent: text("post_content").notNull(),
  hashtags: text("hashtags").array(),
  
  // Content Source
  sourceType: text("source_type"), // BLOG_POST, PROJECT, EVENT, SAFETY, CUSTOM
  sourceId: varchar("source_id"), // ID of linked blog post or project
  
  // AI Generation
  aiPrompt: text("ai_prompt"),
  tone: text("tone"), // professional, casual, marketing, humorous
  
  // Suggested Image
  suggestedImageUrl: text("suggested_image_url"),
  suggestedImagePrompt: text("suggested_image_prompt"),
  
  // Publishing Status
  exported: boolean("exported").default(false),
  exportedAt: timestamp("exported_at"),
  
  createdById: varchar("created_by_id").references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  orgIdx: index("social_post_history_org_idx").on(table.organizationId),
  platformIdx: index("social_post_history_platform_idx").on(table.platform),
}));

export const insertSocialPostHistorySchema = createInsertSchema(socialPostHistory).omit({ id: true, createdAt: true });
export type InsertSocialPostHistory = z.infer<typeof insertSocialPostHistorySchema>;
export type SocialPostHistory = typeof socialPostHistory.$inferSelect;

// Website Contact Form Submissions (CRM Integration)
export const websiteContactSubmissions = pgTable("website_contact_submissions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  websiteId: varchar("website_id").notNull().references(() => organizationWebsites.id, { onDelete: "cascade" }),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  
  // Contact Info
  name: text("name").notNull(),
  email: text("email").notNull(),
  phone: text("phone"),
  company: text("company"),
  
  // Message
  subject: text("subject"),
  message: text("message").notNull(),
  
  // Service Interest
  serviceInterest: text("service_interest"),
  projectType: text("project_type"),
  estimatedBudget: text("estimated_budget"),
  preferredContactMethod: text("preferred_contact_method"),
  
  // Source Tracking
  sourcePage: text("source_page"),
  utmSource: text("utm_source"),
  utmMedium: text("utm_medium"),
  utmCampaign: text("utm_campaign"),
  
  // CRM Integration
  crmOrganisationId: varchar("crm_organisation_id").references(() => crmOrganisations.id),
  crmContactId: varchar("crm_contact_id").references(() => crmContacts.id),
  convertedToCrm: boolean("converted_to_crm").default(false),
  convertedAt: timestamp("converted_at"),
  
  // Status
  read: boolean("read").default(false),
  readAt: timestamp("read_at"),
  responded: boolean("responded").default(false),
  respondedAt: timestamp("responded_at"),
  
  // Metadata
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  websiteIdx: index("contact_submissions_website_idx").on(table.websiteId),
  orgIdx: index("contact_submissions_org_idx").on(table.organizationId),
  emailIdx: index("contact_submissions_email_idx").on(table.email),
}));

export const insertWebsiteContactSubmissionSchema = createInsertSchema(websiteContactSubmissions).omit({ id: true, createdAt: true });
export type InsertWebsiteContactSubmission = z.infer<typeof insertWebsiteContactSubmissionSchema>;
export type WebsiteContactSubmission = typeof websiteContactSubmissions.$inferSelect;

// ====================================================================
// EMAIL AI SYSTEM
// ====================================================================

// Email Provider Enum
export const emailAccounts = pgTable("email_accounts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  provider: emailProviderEnum("provider").notNull(),
  emailAddress: text("email_address").notNull(),
  displayName: text("display_name"),
  
  // OAuth fields (for Gmail/Outlook)
  oauthProviderId: text("oauth_provider_id"),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  expiresAt: timestamp("expires_at"),
  
  // IMAP/SMTP fields
  imapHost: text("imap_host"),
  imapPort: integer("imap_port"),
  imapSecure: boolean("imap_secure"),
  smtpHost: text("smtp_host"),
  smtpPort: integer("smtp_port"),
  smtpSecure: boolean("smtp_secure"),
  imapUsername: text("imap_username"),
  imapPassword: text("imap_password"), // Should be encrypted in production
  
  isActive: boolean("is_active").notNull().default(true),
  lastSyncedAt: timestamp("last_synced_at"),
  lastSyncError: text("last_sync_error"),

  // Incremental sync cursors (Task #522)
  gmailHistoryId: text("gmail_history_id"),
  outlookDeltaInbox: text("outlook_delta_inbox"),
  outlookDeltaSent: text("outlook_delta_sent"),
  lastFullSyncAt: timestamp("last_full_sync_at"),
  // OK | DEGRADED | ERROR | NEEDS_RECONNECT
  syncStatus: text("sync_status").notNull().default("OK"),

  // Real-time push notification subscriptions (Task #524)
  // Gmail: a watch on the user's mailbox publishes events to a Pub/Sub topic.
  // The watch returns the historyId at registration time and an expiration
  // (max 7 days) — we renew before expiry.
  gmailWatchExpiration: timestamp("gmail_watch_expiration"),
  gmailWatchHistoryId: text("gmail_watch_history_id"),
  // Outlook: a Microsoft Graph subscription against the inbox folder posts
  // notifications to our webhook. Subscriptions expire after ~70 hours and
  // we renew before they lapse. clientState is a per-account secret that we
  // verify on every incoming notification.
  outlookSubscriptionId: text("outlook_subscription_id"),
  outlookSubscriptionExpiration: timestamp("outlook_subscription_expiration"),
  outlookSubscriptionClientState: text("outlook_subscription_client_state"),
  // Per-subscription rotating webhook token embedded in the notificationUrl
  // (Task #548). Hardens the Outlook webhook against URL leaks: even if a
  // single subscription's URL is exfiltrated, only that one mailbox's
  // notifications can be replayed, and the token rotates whenever the
  // subscription is recreated. Falls back to the global EMAIL_WEBHOOK_SECRET
  // for local-testing setups that haven't been migrated yet.
  outlookSubscriptionWebhookToken: text("outlook_subscription_webhook_token"),

  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  orgIdx: index("email_accounts_org_idx").on(table.organizationId),
  userIdx: index("email_accounts_user_idx").on(table.userId),
  emailIdx: index("email_accounts_email_idx").on(table.emailAddress),
}));

export const insertEmailAccountSchema = createInsertSchema(emailAccounts).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertEmailAccount = z.infer<typeof insertEmailAccountSchema>;
export type EmailAccount = typeof emailAccounts.$inferSelect;

// Email Threads Table
export const emailThreads = pgTable("email_threads", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  emailAccountId: varchar("email_account_id").notNull().references(() => emailAccounts.id, { onDelete: "cascade" }),
  
  subject: text("subject").notNull(),
  externalThreadId: text("external_thread_id"), // Provider's thread ID
  
  // Linked entities (optional)
  projectId: varchar("project_id").references(() => projects.id, { onDelete: "set null" }),
  bidId: varchar("bid_id").references(() => bids.id, { onDelete: "set null" }),
  vendorId: varchar("vendor_id").references(() => crmOrganisations.id, { onDelete: "set null" }),
  
  status: emailThreadStatusEnum("status").notNull().default("OPEN"),
  messageCount: integer("message_count").notNull().default(0),
  unreadCount: integer("unread_count").notNull().default(0),
  lastMessageAt: timestamp("last_message_at").notNull().defaultNow(),
  
  // AI-generated fields
  aiSummary: text("ai_summary"),
  primaryClassification: emailClassificationEnum("primary_classification"),
  aiMetadata: text("ai_metadata"), // JSON with extracted entities
  
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  orgIdx: index("email_threads_org_idx").on(table.organizationId),
  accountIdx: index("email_threads_account_idx").on(table.emailAccountId),
  projectIdx: index("email_threads_project_idx").on(table.projectId),
  bidIdx: index("email_threads_bid_idx").on(table.bidId),
  statusIdx: index("email_threads_status_idx").on(table.status),
  lastMessageIdx: index("email_threads_last_message_idx").on(table.lastMessageAt),
}));

export const insertEmailThreadSchema = createInsertSchema(emailThreads).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertEmailThread = z.infer<typeof insertEmailThreadSchema>;
export type EmailThread = typeof emailThreads.$inferSelect;

// Email Messages Table
export const emailMessages = pgTable("email_messages", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  emailAccountId: varchar("email_account_id").notNull().references(() => emailAccounts.id, { onDelete: "cascade" }),
  threadId: varchar("thread_id").notNull().references(() => emailThreads.id, { onDelete: "cascade" }),
  
  externalId: text("external_id").notNull(), // Provider message ID
  
  fromAddress: text("from_address").notNull(),
  fromName: text("from_name"),
  toAddresses: text("to_addresses"), // JSON array
  ccAddresses: text("cc_addresses"), // JSON array
  bccAddresses: text("bcc_addresses"), // JSON array
  
  subject: text("subject").notNull(),
  bodyText: text("body_text"),
  bodyHtml: text("body_html"),
  snippet: text("snippet"), // Preview text
  
  receivedAt: timestamp("received_at").notNull(),
  isRead: boolean("is_read").notNull().default(false),
  isIncoming: boolean("is_incoming").notNull().default(true),
  isArchived: boolean("is_archived").notNull().default(false),
  hasAttachments: boolean("has_attachments").notNull().default(false),
  // 'INBOX' | 'SENT' | 'ARCHIVE' | 'OTHER' (Task #522 — informational)
  folder: text("folder").notNull().default("INBOX"),
  // Task #522 — pending state push-back to provider, processed async by job runner.
  // Shape: { isRead?: boolean, isArchived?: boolean, attempts?: number }
  pendingProviderPush: jsonb("pending_provider_push"),

  // AI Classification
  classification: emailClassificationEnum("classification"),
  aiMetadata: text("ai_metadata"), // JSON with extracted data
  aiAnalyzedAt: timestamp("ai_analyzed_at"),
  
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  orgIdx: index("email_messages_org_idx").on(table.organizationId),
  accountIdx: index("email_messages_account_idx").on(table.emailAccountId),
  threadIdx: index("email_messages_thread_idx").on(table.threadId),
  externalIdIdx: index("email_messages_external_id_idx").on(table.externalId),
  receivedAtIdx: index("email_messages_received_at_idx").on(table.receivedAt),
  classificationIdx: index("email_messages_classification_idx").on(table.classification),
  // Idempotency: provider message IDs are unique within an account (Task #522)
  accountExternalIdUnique: uniqueIndex("email_messages_account_external_id_uidx").on(
    table.emailAccountId,
    table.externalId,
  ),
}));

export const insertEmailMessageSchema = createInsertSchema(emailMessages).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertEmailMessage = z.infer<typeof insertEmailMessageSchema>;
export type EmailMessage = typeof emailMessages.$inferSelect;

// Email Attachments Table
export const emailAttachments = pgTable("email_attachments", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  emailMessageId: varchar("email_message_id").notNull().references(() => emailMessages.id, { onDelete: "cascade" }),
  
  filename: text("filename").notNull(),
  contentType: text("content_type").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  storageKey: text("storage_key").notNull(), // Object storage key
  
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  orgIdx: index("email_attachments_org_idx").on(table.organizationId),
  messageIdx: index("email_attachments_message_idx").on(table.emailMessageId),
}));

export const insertEmailAttachmentSchema = createInsertSchema(emailAttachments).omit({ id: true, createdAt: true });
export type InsertEmailAttachment = z.infer<typeof insertEmailAttachmentSchema>;
export type EmailAttachment = typeof emailAttachments.$inferSelect;

// DEPRECATED: email_tasks table
// Email-derived tasks are now stored in the unified 'tasks' table (line 633) with sourceType="EMAIL"
// The emailTasks table is kept for migration reference only. New code should use the unified tasks table.
// See tasks.sourceType, tasks.emailThreadId, tasks.emailMessageId, tasks.aiMetadata for email task fields.

export const emailTasks = pgTable("email_tasks", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  createdByUserId: varchar("created_by_user_id").notNull().references(() => users.id),
  assignedToUserId: varchar("assigned_to_user_id").references(() => users.id),
  projectId: varchar("project_id").references(() => projects.id, { onDelete: "set null" }),
  bidId: varchar("bid_id").references(() => bids.id, { onDelete: "set null" }),
  vendorId: varchar("vendor_id").references(() => crmOrganisations.id, { onDelete: "set null" }),
  emailThreadId: varchar("email_thread_id").references(() => emailThreads.id, { onDelete: "set null" }),
  emailMessageId: varchar("email_message_id").references(() => emailMessages.id, { onDelete: "set null" }),
  title: text("title").notNull(),
  description: text("description"),
  status: aiTaskStatusEnum("status").notNull().default("PENDING"),
  priority: aiTaskPriorityEnum("priority").notNull().default("MEDIUM"),
  dueDate: timestamp("due_date"),
  sourceType: emailTaskSourceEnum("source_type").notNull().default("EMAIL"),
  aiMetadata: text("ai_metadata"),
  completedAt: timestamp("completed_at"),
  completedByUserId: varchar("completed_by_user_id").references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  orgIdx: index("email_tasks_org_idx").on(table.organizationId),
  projectIdx: index("email_tasks_project_idx").on(table.projectId),
  assignedIdx: index("email_tasks_assigned_idx").on(table.assignedToUserId),
  statusIdx: index("email_tasks_status_idx").on(table.status),
  threadIdx: index("email_tasks_thread_idx").on(table.emailThreadId),
  dueDateIdx: index("email_tasks_due_date_idx").on(table.dueDate),
}));

// DEPRECATED: Use insertTaskSchema and Task types instead
export const insertEmailTaskSchema = createInsertSchema(emailTasks).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertEmailTask = z.infer<typeof insertEmailTaskSchema>;
export type EmailTask = typeof emailTasks.$inferSelect;

// AI Email Summaries Table (daily/weekly digest cache)
export const emailSummaries = pgTable("email_summaries", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  
  summaryType: text("summary_type").notNull(), // "DAILY" or "WEEKLY"
  periodStart: timestamp("period_start").notNull(),
  periodEnd: timestamp("period_end").notNull(),
  
  summaryContent: text("summary_content").notNull(), // AI-generated summary
  highlightsJson: text("highlights_json"), // JSON with key points
  
  emailCount: integer("email_count").notNull().default(0),
  tasksCreated: integer("tasks_created").notNull().default(0),
  
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  orgIdx: index("email_summaries_org_idx").on(table.organizationId),
  userIdx: index("email_summaries_user_idx").on(table.userId),
  periodIdx: index("email_summaries_period_idx").on(table.periodStart, table.periodEnd),
}));

export const insertEmailSummarySchema = createInsertSchema(emailSummaries).omit({ id: true, createdAt: true });
export type InsertEmailSummary = z.infer<typeof insertEmailSummarySchema>;
export type EmailSummary = typeof emailSummaries.$inferSelect;

// ============================================
// DASHBOARD CUSTOMIZATION SYSTEM
// ============================================

// Feature Permissions - Granular per-user feature access control (73 flags)
export const userDashboardPermissions = pgTable("user_dashboard_permissions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),

  // Category 1: Core Pages & Navigation (1-10)
  canAccessDashboard: boolean("can_access_dashboard").default(false),
  canAccessProjects: boolean("can_access_projects").default(false),
  projectScope: text("project_scope").default("ALL"),
  canCreateProjects: boolean("can_create_projects").default(false),
  canEditProjects: boolean("can_edit_projects").default(false),
  canAccessCalendar: boolean("can_access_calendar").default(false),
  canAccessTasks: boolean("can_access_tasks").default(false),
  canAccessMessages: boolean("can_access_messages").default(false),
  canAccessBulletins: boolean("can_access_bulletins").default(false),
  canAccessEmailAssistant: boolean("can_access_email_assistant").default(false),

  // Category 2: Pre-Construction & Bidding (11-23)
  canViewBids: boolean("can_view_bids").default(false),
  canEditBids: boolean("can_edit_bids").default(false),
  canDeleteBids: boolean("can_delete_bids").default(false),
  canGenerateBidPDFs: boolean("can_generate_bid_pdfs").default(false),
  canConvertBidToProject: boolean("can_convert_bid_to_project").default(false),
  canAccessBidNetworkGC: boolean("can_access_bid_network_gc").default(false),
  canAccessBidNetworkInbox: boolean("can_access_bid_network_inbox").default(false),
  canManageBidResponses: boolean("can_manage_bid_responses").default(false),
  canDeleteBidRequests: boolean("can_delete_bid_requests").default(false),
  canAccessHistoricalCosts: boolean("can_access_historical_costs").default(false),
  canAccessScopeSettings: boolean("can_access_scope_settings").default(false),
  canUseAiBidAnalysis: boolean("can_use_ai_bid_analysis").default(false),
  canUseAiContractAnalysis: boolean("can_use_ai_contract_analysis").default(false),

  // Category 3: Financial Management (24-35)
  financialsAccess: text("financials_access").default("none"),
  canAccessCostRates: boolean("can_access_cost_rates").default(false),
  canAccessCFODashboard: boolean("can_access_cfo_dashboard").default(false),
  canAccessTMBilling: boolean("can_access_tm_billing").default(false),
  canAccessProgressBilling: boolean("can_access_progress_billing").default(false),
  canManageContracts: boolean("can_manage_contracts").default(false),
  canAccessSubcontracts: boolean("can_access_subcontracts").default(false),
  canAccessOverheadCosts: boolean("can_access_overhead_costs").default(false),
  canAccessProductionRates: boolean("can_access_production_rates").default(false),
  canAccessVendorPricing: boolean("can_access_vendor_pricing").default(false),

  // Category 4: Workforce & Time Management (34-45)
  canAccessTimeClock: boolean("can_access_time_clock").default(false),
  canManageTimeClock: boolean("can_manage_time_clock").default(false),
  canApproveTime: boolean("can_approve_time").default(false),
  canAccessTMDaily: boolean("can_access_tm_daily").default(false),
  canAccessTimeMaterial: boolean("can_access_time_material").default(false),
  canManagePayroll: boolean("can_manage_payroll").default(false),
  canManageCrews: boolean("can_manage_crews").default(false),
  canManageWorkforce: boolean("can_manage_workforce").default(false),
  canManageLeave: boolean("can_manage_leave").default(false),
  canManageSafety: boolean("can_manage_safety").default(false),
  canManageScheduling: boolean("can_manage_scheduling").default(false),
  canAccessKPIs: boolean("can_access_kpis").default(false),
  canLockDailyReports: boolean("can_lock_daily_reports").default(false),

  // Category 5: Operations (46-47)
  canManageEquipment: boolean("can_manage_equipment").default(false),
  canManageProcurement: boolean("can_manage_procurement").default(false),

  // Category 6: CRM & Sales (48-50)
  canAccessCRM: boolean("can_access_crm").default(false),
  canCreateCRMContacts: boolean("can_create_crm_contacts").default(false),
  canAccessMarketplace: boolean("can_access_marketplace").default(false),

  // Category 7: Hiring & Recruitment (51-53)
  canManageHiring: boolean("can_manage_hiring").default(false),
  canAccessHiringInterviews: boolean("can_access_hiring_interviews").default(false),
  canManageHiringSettings: boolean("can_manage_hiring_settings").default(false),

  // Category 8: Marketing & Insights (54-56)
  canPostSocialMedia: boolean("can_post_social_media").default(false),
  canManageWebsite: boolean("can_manage_website").default(false),
  canAccessExecutiveDigest: boolean("can_access_executive_digest").default(false),

  // Category 9: AI Features (57-59)
  canUseAiFeatures: boolean("can_use_ai_features").default(false),
  canViewSafety: boolean("can_view_safety").default(false),
  canViewAiSummaries: boolean("can_view_ai_summaries").default(false),

  // Category 10: Administration (60-66)
  canAccessCompanySettings: boolean("can_access_company_settings").default(false),
  canManageUsers: boolean("can_manage_users").default(false),
  canAccessApprovals: boolean("can_access_approvals").default(false),
  canAccessAuditLogs: boolean("can_access_audit_logs").default(false),
  canAccessReports: boolean("can_access_reports").default(false),
  canAccessEnterpriseSettings: boolean("can_access_enterprise_settings").default(false),
  canManageAISettings: boolean("can_manage_ai_settings").default(false),

  // Category 11: Project Detail Tabs (65-73)
  canViewProjectBudget: boolean("can_view_project_budget").default(false),
  canViewProjectEstimates: boolean("can_view_project_estimates").default(false),
  canViewProjectProcurement: boolean("can_view_project_procurement").default(false),
  canViewProjectReceipts: boolean("can_view_project_receipts").default(false),
  canViewProjectTimeEntries: boolean("can_view_project_time_entries").default(false),
  canViewProjectSubcontractors: boolean("can_view_project_subcontractors").default(false),
  canCreateChangeOrders: boolean("can_create_change_orders").default(false),
  canDeleteScopeItems: boolean("can_delete_scope_items").default(false),
  canEditProjectHandoff: boolean("can_edit_project_handoff").default(false),

  // Category 12: Peer Ratings (74-75)
  canSubmitPeerRatings: boolean("can_submit_peer_ratings").default(false),
  canViewPeerRatings: boolean("can_view_peer_ratings").default(false),

  // Category 13: Heavy Civil / DOT (76-93)
  canViewDotLibrary: boolean("can_view_dot_library").default(false),
  canManageDotLibrary: boolean("can_manage_dot_library").default(false),
  canViewDbeGoals: boolean("can_view_dbe_goals").default(false),
  canManageDbeGoals: boolean("can_manage_dbe_goals").default(false),
  canViewHaulTickets: boolean("can_view_haul_tickets").default(false),
  canManageHaulTickets: boolean("can_manage_haul_tickets").default(false),
  canApproveHaulTickets: boolean("can_approve_haul_tickets").default(false),
  canViewInspectorReports: boolean("can_view_inspector_reports").default(false),
  canSubmitInspectorReports: boolean("can_submit_inspector_reports").default(false),
  canManageInspectorReports: boolean("can_manage_inspector_reports").default(false),
  canApproveInspectorReports: boolean("can_approve_inspector_reports").default(false),
  canViewSwppp: boolean("can_view_swppp").default(false),
  canManageSwppp: boolean("can_manage_swppp").default(false),
  canViewMaterialCertifications: boolean("can_view_material_certifications").default(false),
  canManageMaterialCertifications: boolean("can_manage_material_certifications").default(false),
  canVerifyMaterialCertifications: boolean("can_verify_material_certifications").default(false),
  canViewSuretyBonds: boolean("can_view_surety_bonds").default(false),
  canManageSuretyBonds: boolean("can_manage_surety_bonds").default(false),
  canViewComplianceDashboard: boolean("can_view_compliance_dashboard").default(false),

  // Granted by admin
  grantedByUserId: varchar("granted_by_user_id").references(() => users.id),
  grantedAt: timestamp("granted_at"),

  appliedPresetId: varchar("applied_preset_id").references(() => permissionPresets.id, { onDelete: "set null" }),

  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  orgIdx: index("user_dashboard_permissions_org_idx").on(table.organizationId),
  userIdx: index("user_dashboard_permissions_user_idx").on(table.userId),
  orgUserUnique: unique("user_dashboard_permissions_org_user_unique").on(table.organizationId, table.userId),
}));

export const insertUserDashboardPermissionSchema = createInsertSchema(userDashboardPermissions).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertUserDashboardPermission = z.infer<typeof insertUserDashboardPermissionSchema>;
export type UserDashboardPermission = typeof userDashboardPermissions.$inferSelect;

export const permissionPresets = pgTable("permission_presets", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  targetRole: varchar("target_role", { length: 50 }).notNull(),
  permissions: text("permissions").notNull(),
  isBuiltIn: boolean("is_built_in").notNull().default(false),
  organizationId: varchar("organization_id").references(() => organizations.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  orgIdx: index("permission_presets_org_idx").on(table.organizationId),
  roleIdx: index("permission_presets_role_idx").on(table.targetRole),
}));

export const insertPermissionPresetSchema = createInsertSchema(permissionPresets).omit({ id: true, createdAt: true });
export type InsertPermissionPreset = z.infer<typeof insertPermissionPresetSchema>;
export type PermissionPreset = typeof permissionPresets.$inferSelect;

// User Dashboard Layouts - Store widget arrangement per user
export const userDashboardLayouts = pgTable("user_dashboard_layouts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  
  // Layout configuration stored as JSON
  // Format: { widgets: [{ id, type, x, y, w, h, visible }], gridCols, version }
  layoutConfig: text("layout_config").notNull(),
  
  // Track if using default or custom layout
  isCustom: boolean("is_custom").notNull().default(false),
  
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  orgIdx: index("user_dashboard_layouts_org_idx").on(table.organizationId),
  userIdx: index("user_dashboard_layouts_user_idx").on(table.userId),
  orgUserUnique: unique("user_dashboard_layouts_org_user_unique").on(table.organizationId, table.userId),
}));

export const insertUserDashboardLayoutSchema = createInsertSchema(userDashboardLayouts).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertUserDashboardLayout = z.infer<typeof insertUserDashboardLayoutSchema>;
export type UserDashboardLayout = typeof userDashboardLayouts.$inferSelect;

// User Color Palettes - Store color scheme preferences per user
export const userColorPalettes = pgTable("user_color_palettes", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  
  // Palette name (for presets or custom)
  paletteName: text("palette_name").notNull().default("Default"),
  isPreset: boolean("is_preset").notNull().default(false),
  
  // Light mode colors (HSL format without hsl() wrapper, e.g., "220 14% 96%")
  lightPrimary: text("light_primary"),
  lightPrimaryForeground: text("light_primary_foreground"),
  lightSecondary: text("light_secondary"),
  lightSecondaryForeground: text("light_secondary_foreground"),
  lightAccent: text("light_accent"),
  lightAccentForeground: text("light_accent_foreground"),
  lightBackground: text("light_background"),
  lightForeground: text("light_foreground"),
  lightMuted: text("light_muted"),
  lightMutedForeground: text("light_muted_foreground"),
  lightCard: text("light_card"),
  lightCardForeground: text("light_card_foreground"),
  lightBorder: text("light_border"),
  
  // Dark mode colors (HSL format)
  darkPrimary: text("dark_primary"),
  darkPrimaryForeground: text("dark_primary_foreground"),
  darkSecondary: text("dark_secondary"),
  darkSecondaryForeground: text("dark_secondary_foreground"),
  darkAccent: text("dark_accent"),
  darkAccentForeground: text("dark_accent_foreground"),
  darkBackground: text("dark_background"),
  darkForeground: text("dark_foreground"),
  darkMuted: text("dark_muted"),
  darkMutedForeground: text("dark_muted_foreground"),
  darkCard: text("dark_card"),
  darkCardForeground: text("dark_card_foreground"),
  darkBorder: text("dark_border"),
  
  // Contrast validation metadata
  contrastValidated: boolean("contrast_validated").notNull().default(false),
  lastValidatedAt: timestamp("last_validated_at"),
  
  // Track if using custom or org default
  isActive: boolean("is_active").notNull().default(false),
  
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  orgIdx: index("user_color_palettes_org_idx").on(table.organizationId),
  userIdx: index("user_color_palettes_user_idx").on(table.userId),
}));

export const insertUserColorPaletteSchema = createInsertSchema(userColorPalettes).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertUserColorPalette = z.infer<typeof insertUserColorPaletteSchema>;
export type UserColorPalette = typeof userColorPalettes.$inferSelect;

export const orgColorPalettes = pgTable("org_color_palettes", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  paletteName: text("palette_name").notNull().default("Organization Default"),
  isPreset: boolean("is_preset").notNull().default(false),
  lightPrimary: text("light_primary"),
  lightPrimaryForeground: text("light_primary_foreground"),
  lightSecondary: text("light_secondary"),
  lightSecondaryForeground: text("light_secondary_foreground"),
  lightAccent: text("light_accent"),
  lightAccentForeground: text("light_accent_foreground"),
  lightBackground: text("light_background"),
  lightForeground: text("light_foreground"),
  lightMuted: text("light_muted"),
  lightMutedForeground: text("light_muted_foreground"),
  lightCard: text("light_card"),
  lightCardForeground: text("light_card_foreground"),
  lightBorder: text("light_border"),
  darkPrimary: text("dark_primary"),
  darkPrimaryForeground: text("dark_primary_foreground"),
  darkSecondary: text("dark_secondary"),
  darkSecondaryForeground: text("dark_secondary_foreground"),
  darkAccent: text("dark_accent"),
  darkAccentForeground: text("dark_accent_foreground"),
  darkBackground: text("dark_background"),
  darkForeground: text("dark_foreground"),
  darkMuted: text("dark_muted"),
  darkMutedForeground: text("dark_muted_foreground"),
  darkCard: text("dark_card"),
  darkCardForeground: text("dark_card_foreground"),
  darkBorder: text("dark_border"),
  contrastValidated: boolean("contrast_validated").notNull().default(false),
  lastValidatedAt: timestamp("last_validated_at"),
  isActive: boolean("is_active").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  orgIdx: index("org_color_palettes_org_idx").on(table.organizationId),
}));

export const insertOrgColorPaletteSchema = createInsertSchema(orgColorPalettes).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertOrgColorPalette = z.infer<typeof insertOrgColorPaletteSchema>;
export type OrgColorPalette = typeof orgColorPalettes.$inferSelect;

// Hustler Multi-Organization System
// Allows HUSTLER role users to own/manage multiple organizations
export const hustlerOrganizations = pgTable("hustler_organizations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  roleOverride: userRoleEnum("role_override"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  userIdx: index("hustler_org_user_idx").on(table.userId),
  orgIdx: index("hustler_org_org_idx").on(table.organizationId),
  userOrgUnique: unique("hustler_org_user_org_unique").on(table.userId, table.organizationId),
}));

export const insertHustlerOrganizationSchema = createInsertSchema(hustlerOrganizations).omit({ id: true, createdAt: true });
export type InsertHustlerOrganization = z.infer<typeof insertHustlerOrganizationSchema>;
export type HustlerOrganization = typeof hustlerOrganizations.$inferSelect;

// Hustler Link Requests - Invitation/Request workflow for linking HUSTLERs to organizations
export const hustlerLinkRequests = pgTable("hustler_link_requests", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  // The HUSTLER user requesting or being invited
  hustlerUserId: varchar("hustler_user_id").references(() => users.id, { onDelete: "cascade" }),
  hustlerEmail: text("hustler_email"), // Email for pending invites where user may not exist yet
  // The organization to be linked
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  // Who initiated the request
  initiatedByUserId: varchar("initiated_by_user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  // Type: INVITE (admin invites hustler) or REQUEST (hustler requests access)
  requestType: text("request_type").notNull().default("INVITE"), // "INVITE" or "REQUEST"
  // Status workflow
  status: hustlerLinkRequestStatusEnum("status").notNull().default("PENDING"),
  // Secure token for email invites
  inviteToken: text("invite_token"),
  inviteTokenHash: text("invite_token_hash"),
  // Optional role override granted upon approval
  roleOverride: userRoleEnum("role_override"),
  // Message from requester/inviter
  message: text("message"),
  // Timestamps
  expiresAt: timestamp("expires_at"),
  respondedAt: timestamp("responded_at"),
  respondedByUserId: varchar("responded_by_user_id").references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  hustlerIdx: index("hustler_link_req_hustler_idx").on(table.hustlerUserId),
  orgIdx: index("hustler_link_req_org_idx").on(table.organizationId),
  statusIdx: index("hustler_link_req_status_idx").on(table.status),
  tokenIdx: index("hustler_link_req_token_idx").on(table.inviteTokenHash),
}));

export const insertHustlerLinkRequestSchema = createInsertSchema(hustlerLinkRequests).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertHustlerLinkRequest = z.infer<typeof insertHustlerLinkRequestSchema>;
export type HustlerLinkRequest = typeof hustlerLinkRequests.$inferSelect;

// HUSTLER Delegates - COO and other executives who can manage organizations on behalf of the HUSTLER
export const hustlerDelegates = pgTable("hustler_delegates", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  // The HUSTLER who owns this delegate relationship
  hustlerUserId: varchar("hustler_user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  // The delegate user (COO, etc.)
  delegateUserId: varchar("delegate_user_id").references(() => users.id, { onDelete: "cascade" }),
  // Email for pending invites where delegate user may not exist yet
  delegateEmail: text("delegate_email"),
  // The delegate's role in the HUSTLER's portfolio
  delegateRole: hustlerDelegateRoleEnum("delegate_role").notNull().default("COO"),
  // Invite token for pending invites
  inviteToken: text("invite_token"),
  inviteTokenHash: text("invite_token_hash"),
  // Status
  status: hustlerLinkRequestStatusEnum("status").notNull().default("PENDING"),
  // Permissions - what the delegate can do
  canCreateOrganizations: boolean("can_create_organizations").notNull().default(true),
  canManageAllOrganizations: boolean("can_manage_all_organizations").notNull().default(true),
  financialsAccess: text("financials_access").notNull().default("view"),
  canInviteOtherDelegates: boolean("can_invite_other_delegates").notNull().default(false),
  // Timestamps
  expiresAt: timestamp("expires_at"),
  acceptedAt: timestamp("accepted_at"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  hustlerIdx: index("hustler_delegate_hustler_idx").on(table.hustlerUserId),
  delegateIdx: index("hustler_delegate_delegate_idx").on(table.delegateUserId),
  tokenIdx: index("hustler_delegate_token_idx").on(table.inviteTokenHash),
  uniqueDelegate: unique("hustler_delegate_unique").on(table.hustlerUserId, table.delegateUserId),
}));

export const insertHustlerDelegateSchema = createInsertSchema(hustlerDelegates).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertHustlerDelegate = z.infer<typeof insertHustlerDelegateSchema>;
export type HustlerDelegate = typeof hustlerDelegates.$inferSelect;

// ============================================
// SUBCONTRACTOR BID REQUEST NETWORK SYSTEM
// Platform-wide bid solicitation like PlanHub/BuildingConnected
// ============================================

// Enums for bid request network
export const organizationNetworkSettings = pgTable("organization_network_settings", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }).unique(),
  
  // Master toggles
  isNetworkEnabled: boolean("is_network_enabled").notNull().default(true),           // Overall participation in network
  canReceiveBidInvites: boolean("can_receive_bid_invites").notNull().default(true),  // Receive invites from other orgs
  canSendBidRequests: boolean("can_send_bid_requests").notNull().default(true),      // Send invites to other orgs
  
  // Trade specialties (for matching) - array of trade types this org performs
  tradeSpecialties: text("trade_specialties").array(),  // Store as array of trade type strings
  
  // Preferences
  autoAcceptFromTrustedGCs: boolean("auto_accept_from_trusted_gcs").notNull().default(false),
  trustedGCOrganizationIds: text("trusted_gc_organization_ids").array(),
  maxActiveInvites: integer("max_active_invites").default(50),
  notifyByEmail: boolean("notify_by_email").notNull().default(true),
  notifyInApp: boolean("notify_in_app").notNull().default(true),
  
  // Profile info visible to network
  companyDescription: text("company_description"),
  serviceAreas: text("service_areas").array(),  // Geographic regions served
  certifications: text("certifications").array(),
  yearsInBusiness: integer("years_in_business"),

  // Marketplace directory fields
  bio: text("bio"),
  foundedYear: integer("founded_year"),
  licenseNumbers: text("license_numbers").array(),
  portfolioPhotos: text("portfolio_photos").array(),
  isDirectoryListed: boolean("is_directory_listed").notNull().default(false),
  avgRating: decimal("avg_rating", { precision: 3, scale: 2 }),
  reviewCount: integer("review_count").notNull().default(0),
  
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  orgIdx: index("org_network_settings_org_idx").on(table.organizationId),
}));

export const insertOrganizationNetworkSettingsSchema = createInsertSchema(organizationNetworkSettings).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertOrganizationNetworkSettings = z.infer<typeof insertOrganizationNetworkSettingsSchema>;
export type OrganizationNetworkSettings = typeof organizationNetworkSettings.$inferSelect;

// Marketplace Reviews
export const marketplaceReviews = pgTable("marketplace_reviews", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  reviewerOrgId: varchar("reviewer_org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  revieweeOrgId: varchar("reviewee_org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  rating: integer("rating").notNull(),  // 1-5
  comment: text("comment"),
  projectRef: text("project_ref"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  reviewerIdx: index("marketplace_reviews_reviewer_idx").on(table.reviewerOrgId),
  revieweeIdx: index("marketplace_reviews_reviewee_idx").on(table.revieweeOrgId),
  uniquePairIdx: unique("marketplace_reviews_unique_pair").on(table.reviewerOrgId, table.revieweeOrgId),
}));

export const insertMarketplaceReviewSchema = createInsertSchema(marketplaceReviews).omit({ id: true, createdAt: true });
export type InsertMarketplaceReview = z.infer<typeof insertMarketplaceReviewSchema>;
export type MarketplaceReview = typeof marketplaceReviews.$inferSelect;

// Subcontractor Bid Requests - GC creates a request for quotes
export const subcontractorBidRequests = pgTable("subcontractor_bid_requests", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  projectId: varchar("project_id").references(() => projects.id, { onDelete: "set null" }),
  bidId: varchar("bid_id").references(() => bids.id, { onDelete: "set null" }),
  
  // Request details
  title: text("title").notNull(),
  description: text("description"),
  scopeOfWork: text("scope_of_work").notNull(),
  
  // Trade requirements
  requiredTrades: text("required_trades").array().notNull(),  // Trade types needed
  
  // Timeline
  bidDueDate: timestamp("bid_due_date").notNull(),
  projectStartDate: date("project_start_date"),
  projectEndDate: date("project_end_date"),
  
  // Location
  projectAddress: text("project_address"),
  projectCity: text("project_city"),
  projectState: text("project_state"),
  projectZip: text("project_zip"),
  
  // Budget hints (optional - GC may not want to disclose)
  budgetRangeMin: decimal("budget_range_min", { precision: 14, scale: 2 }),
  budgetRangeMax: decimal("budget_range_max", { precision: 14, scale: 2 }),
  showBudgetToSubs: boolean("show_budget_to_subs").notNull().default(false),
  
  // Requirements
  requiresBonding: boolean("requires_bonding").notNull().default(false),
  requiresInsurance: boolean("requires_insurance").notNull().default(true),
  insuranceMinimum: decimal("insurance_minimum", { precision: 14, scale: 2 }),
  specialRequirements: text("special_requirements"),
  
  // Attached documents (scope docs, plans, specs)
  attachedFileUrls: text("attached_file_urls").array(),
  attachedFileNames: text("attached_file_names").array(),
  
  // Status
  status: bidRequestStatusEnum("status").notNull().default("DRAFT"),
  publishedAt: timestamp("published_at"),
  closedAt: timestamp("closed_at"),
  awardedAt: timestamp("awarded_at"),
  awardedToOrganizationId: varchar("awarded_to_organization_id").references(() => organizations.id),
  
  // GC notes (private, not visible to subs)
  internalNotes: text("internal_notes"),
  
  // Tracking
  viewCount: integer("view_count").notNull().default(0),
  inviteCount: integer("invite_count").notNull().default(0),
  responseCount: integer("response_count").notNull().default(0),
  
  createdByUserId: varchar("created_by_user_id").references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  orgIdx: index("sub_bid_req_org_idx").on(table.organizationId),
  projectIdx: index("sub_bid_req_project_idx").on(table.projectId),
  statusIdx: index("sub_bid_req_status_idx").on(table.status),
  dueDateIdx: index("sub_bid_req_due_date_idx").on(table.bidDueDate),
}));

export const insertSubcontractorBidRequestSchema = createInsertSchema(subcontractorBidRequests).omit({ id: true, createdAt: true, updatedAt: true, publishedAt: true, closedAt: true, awardedAt: true, viewCount: true, inviteCount: true, responseCount: true });
export type InsertSubcontractorBidRequest = z.infer<typeof insertSubcontractorBidRequestSchema>;
export type SubcontractorBidRequest = typeof subcontractorBidRequests.$inferSelect;

// Subcontractor Bid Invitations - Tracks which subs are invited to bid
export const subcontractorBidInvitations = pgTable("subcontractor_bid_invitations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  bidRequestId: varchar("bid_request_id").notNull().references(() => subcontractorBidRequests.id, { onDelete: "cascade" }),
  
  // Invited organization (platform member)
  invitedOrganizationId: varchar("invited_organization_id").references(() => organizations.id, { onDelete: "cascade" }),
  
  // OR external contact (non-platform member)
  externalCompanyName: text("external_company_name"),
  externalContactName: text("external_contact_name"),
  externalContactEmail: text("external_contact_email"),
  externalContactPhone: text("external_contact_phone"),
  
  // Invitation details
  invitedTradeType: tradeTypeEnum("invited_trade_type"),
  personalMessage: text("personal_message"),
  
  // Status tracking
  status: bidInvitationStatusEnum("status").notNull().default("PENDING"),
  viewedAt: timestamp("viewed_at"),
  respondedAt: timestamp("responded_at"),
  declinedReason: text("declined_reason"),
  
  // Notifications
  emailSentAt: timestamp("email_sent_at"),
  reminderSentAt: timestamp("reminder_sent_at"),
  reminderCount: integer("reminder_count").notNull().default(0),
  
  invitedByUserId: varchar("invited_by_user_id").references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  requestIdx: index("sub_bid_inv_request_idx").on(table.bidRequestId),
  orgIdx: index("sub_bid_inv_org_idx").on(table.invitedOrganizationId),
  statusIdx: index("sub_bid_inv_status_idx").on(table.status),
  uniqueInvite: unique("sub_bid_inv_unique").on(table.bidRequestId, table.invitedOrganizationId),
}));

export const insertSubcontractorBidInvitationSchema = createInsertSchema(subcontractorBidInvitations).omit({ id: true, createdAt: true, updatedAt: true, viewedAt: true, respondedAt: true, emailSentAt: true, reminderSentAt: true, reminderCount: true });
export type InsertSubcontractorBidInvitation = z.infer<typeof insertSubcontractorBidInvitationSchema>;
export type SubcontractorBidInvitation = typeof subcontractorBidInvitations.$inferSelect;

// Subcontractor Bid Responses - Sub's submitted quotes
export const subcontractorBidResponses = pgTable("subcontractor_bid_responses", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  invitationId: varchar("invitation_id").notNull().references(() => subcontractorBidInvitations.id, { onDelete: "cascade" }),
  bidRequestId: varchar("bid_request_id").notNull().references(() => subcontractorBidRequests.id, { onDelete: "cascade" }),
  respondingOrganizationId: varchar("responding_organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  
  // Quote details
  totalBidAmount: decimal("total_bid_amount", { precision: 14, scale: 2 }).notNull(),
  laborCost: decimal("labor_cost", { precision: 14, scale: 2 }),
  materialCost: decimal("material_cost", { precision: 14, scale: 2 }),
  equipmentCost: decimal("equipment_cost", { precision: 14, scale: 2 }),
  otherCost: decimal("other_cost", { precision: 14, scale: 2 }),
  
  // Quote breakdown (optional detailed line items as JSON)
  lineItemsJson: text("line_items_json"),
  
  // Proposal details
  proposalNotes: text("proposal_notes"),
  scopeInclusions: text("scope_inclusions"),
  scopeExclusions: text("scope_exclusions"),
  assumptions: text("assumptions"),
  
  // Timeline
  proposedStartDate: date("proposed_start_date"),
  proposedDuration: integer("proposed_duration"),  // in days
  proposedDurationUnit: text("proposed_duration_unit").default("DAYS"),  // DAYS, WEEKS
  
  // Attached documents
  attachedFileUrls: text("attached_file_urls").array(),
  attachedFileNames: text("attached_file_names").array(),
  
  // Validity
  quoteValidUntil: date("quote_valid_until"),
  
  // Status
  status: bidResponseStatusEnum("status").notNull().default("DRAFT"),
  submittedAt: timestamp("submitted_at"),
  reviewedAt: timestamp("reviewed_at"),
  reviewedByUserId: varchar("reviewed_by_user_id").references(() => users.id),
  
  // GC feedback (private)
  gcInternalRating: integer("gc_internal_rating"),  // 1-5 stars
  gcInternalNotes: text("gc_internal_notes"),
  
  // Sub's internal notes (private to sub)
  subInternalNotes: text("sub_internal_notes"),
  
  createdByUserId: varchar("created_by_user_id").references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  invitationIdx: index("sub_bid_resp_invitation_idx").on(table.invitationId),
  requestIdx: index("sub_bid_resp_request_idx").on(table.bidRequestId),
  orgIdx: index("sub_bid_resp_org_idx").on(table.respondingOrganizationId),
  statusIdx: index("sub_bid_resp_status_idx").on(table.status),
}));

export const insertSubcontractorBidResponseSchema = createInsertSchema(subcontractorBidResponses).omit({ id: true, createdAt: true, updatedAt: true, submittedAt: true, reviewedAt: true });
export type InsertSubcontractorBidResponse = z.infer<typeof insertSubcontractorBidResponseSchema>;
export type SubcontractorBidResponse = typeof subcontractorBidResponses.$inferSelect;

// Bid Request Clarifications - Q&A thread for bid requests
export const bidRequestClarifications = pgTable("bid_request_clarifications", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  bidRequestId: varchar("bid_request_id").notNull().references(() => subcontractorBidRequests.id, { onDelete: "cascade" }),
  
  // Who asked/answered
  askedByOrganizationId: varchar("asked_by_organization_id").references(() => organizations.id),
  askedByUserId: varchar("asked_by_user_id").references(() => users.id),
  
  // Question
  question: text("question").notNull(),
  questionAskedAt: timestamp("question_asked_at").notNull().defaultNow(),
  
  // Answer (by GC)
  answer: text("answer"),
  answeredByUserId: varchar("answered_by_user_id").references(() => users.id),
  answeredAt: timestamp("answered_at"),
  
  // Visibility
  isPublicToAllInvitees: boolean("is_public_to_all_invitees").notNull().default(false),  // If true, all invitees can see Q&A
  
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  requestIdx: index("bid_clarification_request_idx").on(table.bidRequestId),
  askedByIdx: index("bid_clarification_asked_by_idx").on(table.askedByOrganizationId),
}));

export const insertBidRequestClarificationSchema = createInsertSchema(bidRequestClarifications).omit({ id: true, createdAt: true, updatedAt: true, answeredAt: true });
export type InsertBidRequestClarification = z.infer<typeof insertBidRequestClarificationSchema>;
export type BidRequestClarification = typeof bidRequestClarifications.$inferSelect;

// Pricebook Import Jobs table - tracks AI extraction jobs for vendor price lists
export const pricebookImportJobs = pgTable("pricebook_import_jobs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  crmOrganisationId: varchar("crm_organisation_id").notNull().references(() => crmOrganisations.id, { onDelete: "cascade" }),
  fileRef: text("file_ref").notNull(),
  fileName: text("file_name").notNull(),
  status: pricebookImportJobStatusEnum("status").notNull().default("PENDING"),
  itemsExtracted: integer("items_extracted").default(0),
  itemsApproved: integer("items_approved").default(0),
  errorMessage: text("error_message"),
  effectiveQuarter: text("effective_quarter"),
  effectiveDate: timestamp("effective_date"),
  processedAt: timestamp("processed_at"),
  createdById: varchar("created_by_id").notNull().references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  orgIdx: index("pricebook_import_jobs_org_idx").on(table.organizationId),
  vendorIdx: index("pricebook_import_jobs_vendor_idx").on(table.crmOrganisationId),
  statusIdx: index("pricebook_import_jobs_status_idx").on(table.status),
}));

export const insertPricebookImportJobSchema = createInsertSchema(pricebookImportJobs).omit({ id: true, createdAt: true, updatedAt: true, processedAt: true });
export type InsertPricebookImportJob = z.infer<typeof insertPricebookImportJobSchema>;
export type PricebookImportJob = typeof pricebookImportJobs.$inferSelect;

// Dashboard Widget Configuration Type (for layout JSON)
export interface DashboardWidgetConfig {
  id: string;
  type: string;
  x: number;
  y: number;
  w: number;
  h: number;
  visible: boolean;
  minW?: number;
  minH?: number;
  maxW?: number;
  maxH?: number;
}

export interface DashboardSectionConfig {
  id: string;
  title: string;
  columns: number;
  collapsed: boolean;
  widgets: DashboardWidgetConfig[];
}

export interface DashboardLayoutConfig {
  sections: DashboardSectionConfig[];
  gridCols: number;
  version: number;
}

// Color palette validation result type
export interface ColorContrastResult {
  isValid: boolean;
  contrastRatio: number;
  wcagLevel: "AAA" | "AA" | "FAIL";
  pair: string;
}

export interface PaletteValidationResult {
  isValid: boolean;
  results: ColorContrastResult[];
  failedPairs: string[];
}

// ==========================================
// FIELD PRODUCTIVITY SYSTEM
// ==========================================

// Field Productivity Enums
export const voiceLogs = pgTable("voice_logs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  projectId: varchar("project_id").references(() => projects.id, { onDelete: "set null" }),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  
  // Audio details
  audioUrl: text("audio_url").notNull(),
  audioObjectKey: text("audio_object_key"),
  duration: integer("duration"),  // in seconds
  
  // Transcription
  transcription: text("transcription"),
  status: voiceLogStatusEnum("status").notNull().default("PENDING"),
  transcribedAt: timestamp("transcribed_at"),
  errorMessage: text("error_message"),
  
  // AI-extracted metadata
  aiSummary: text("ai_summary"),
  aiTags: text("ai_tags").array(),
  aiSentiment: text("ai_sentiment"),  // POSITIVE, NEUTRAL, NEGATIVE, URGENT
  
  // Location
  latitude: doublePrecision("latitude"),
  longitude: doublePrecision("longitude"),
  
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  orgIdx: index("voice_logs_org_idx").on(table.organizationId),
  projectIdx: index("voice_logs_project_idx").on(table.projectId),
  userIdx: index("voice_logs_user_idx").on(table.userId),
  statusIdx: index("voice_logs_status_idx").on(table.status),
}));

export const insertVoiceLogSchema = createInsertSchema(voiceLogs).omit({ id: true, createdAt: true, updatedAt: true, transcribedAt: true });
export type InsertVoiceLog = z.infer<typeof insertVoiceLogSchema>;
export type VoiceLog = typeof voiceLogs.$inferSelect;

// Issue Captures table - Field issue/problem documentation
export const issueCaptures = pgTable("issue_captures", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  projectId: varchar("project_id").references(() => projects.id, { onDelete: "set null" }),
  createdById: varchar("created_by_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  assignedToId: varchar("assigned_to_id").references(() => users.id, { onDelete: "set null" }),
  
  // Issue details
  title: text("title").notNull(),
  description: text("description"),
  severity: issueSeverityEnum("severity").notNull().default("MEDIUM"),
  status: issueStatusEnum("status").notNull().default("OPEN"),
  
  // Photos/evidence
  photoUrls: text("photo_urls").array(),
  photoObjectKeys: text("photo_object_keys").array(),
  
  // Location
  location: text("location"),  // Text description of location
  latitude: doublePrecision("latitude"),
  longitude: doublePrecision("longitude"),
  
  // Trade/category
  tradeAffected: text("trade_affected"),
  category: text("category"),  // SAFETY, QUALITY, DELAY, DESIGN, OTHER
  
  // Resolution
  resolutionNotes: text("resolution_notes"),
  resolvedById: varchar("resolved_by_id").references(() => users.id),
  resolvedAt: timestamp("resolved_at"),
  
  // AI analysis
  aiAnalysis: text("ai_analysis"),
  aiRecommendations: text("ai_recommendations"),
  
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  orgIdx: index("issue_captures_org_idx").on(table.organizationId),
  projectIdx: index("issue_captures_project_idx").on(table.projectId),
  createdByIdx: index("issue_captures_created_by_idx").on(table.createdById),
  severityIdx: index("issue_captures_severity_idx").on(table.severity),
  statusIdx: index("issue_captures_status_idx").on(table.status),
}));

export const insertIssueCaptureSchema = createInsertSchema(issueCaptures).omit({ id: true, createdAt: true, updatedAt: true, resolvedAt: true });
export type InsertIssueCapture = z.infer<typeof insertIssueCaptureSchema>;
export type IssueCapture = typeof issueCaptures.$inferSelect;

// Offline Sync Queue table - Queue for offline operations
export const offlineSyncQueue = pgTable("offline_sync_queue", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  
  // Operation details
  operationType: offlineOperationTypeEnum("operation_type").notNull(),
  entityType: offlineEntityTypeEnum("entity_type").notNull(),
  entityId: varchar("entity_id"),  // Local ID before sync
  payload: json("payload").notNull(),  // The data to sync
  
  // Sync status
  status: offlineSyncStatusEnum("status").notNull().default("PENDING"),
  syncedAt: timestamp("synced_at"),
  syncedEntityId: varchar("synced_entity_id"),  // Server ID after sync
  
  // Error handling
  errorMessage: text("error_message"),
  retryCount: integer("retry_count").notNull().default(0),
  lastRetryAt: timestamp("last_retry_at"),
  
  // Metadata
  deviceId: text("device_id"),
  clientTimestamp: timestamp("client_timestamp"),
  
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  orgIdx: index("offline_sync_org_idx").on(table.organizationId),
  userIdx: index("offline_sync_user_idx").on(table.userId),
  statusIdx: index("offline_sync_status_idx").on(table.status),
  entityIdx: index("offline_sync_entity_idx").on(table.entityType, table.entityId),
}));

export const insertOfflineSyncQueueSchema = createInsertSchema(offlineSyncQueue).omit({ id: true, createdAt: true, updatedAt: true, syncedAt: true });
export type InsertOfflineSyncQueue = z.infer<typeof insertOfflineSyncQueueSchema>;
export type OfflineSyncQueue = typeof offlineSyncQueue.$inferSelect;

// ==========================================
// MARKETPLACE SYSTEM
// ==========================================

// Marketplace Enums
export const vendorScores = pgTable("vendor_scores", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  crmEntityId: varchar("crm_entity_id").notNull().references(() => crmOrganisations.id, { onDelete: "cascade" }),
  projectId: varchar("project_id").references(() => projects.id, { onDelete: "set null" }),
  
  // Scoring date
  scoreDate: date("score_date").notNull(),
  
  // Individual category scores (1-5 scale)
  onTimeDeliveryScore: decimal("on_time_delivery_score", { precision: 3, scale: 2 }),
  qualityScore: decimal("quality_score", { precision: 3, scale: 2 }),
  communicationScore: decimal("communication_score", { precision: 3, scale: 2 }),
  priceCompetitivenessScore: decimal("price_competitiveness_score", { precision: 3, scale: 2 }),
  reliabilityScore: decimal("reliability_score", { precision: 3, scale: 2 }),
  
  // Overall calculated score
  overallScore: decimal("overall_score", { precision: 3, scale: 2 }),
  
  // Additional context
  notes: text("notes"),
  scoredById: varchar("scored_by_id").notNull().references(() => users.id),
  
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  orgIdx: index("vendor_scores_org_idx").on(table.organizationId),
  vendorIdx: index("vendor_scores_vendor_idx").on(table.crmEntityId),
  projectIdx: index("vendor_scores_project_idx").on(table.projectId),
  scoreDateIdx: index("vendor_scores_date_idx").on(table.scoreDate),
}));

export const insertVendorScoreSchema = createInsertSchema(vendorScores).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertVendorScore = z.infer<typeof insertVendorScoreSchema>;
export type VendorScore = typeof vendorScores.$inferSelect;

// Material Price Index table - Track material pricing over time
export const materialPriceIndex = pgTable("material_price_index", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  
  // Material identification
  materialName: text("material_name").notNull(),
  materialCategory: text("material_category"),  // CONCRETE, LUMBER, STEEL, etc.
  materialSku: text("material_sku"),  // Vendor-specific SKU
  
  // Unit and pricing
  unitOfMeasure: text("unit_of_measure").notNull(),  // CY, LF, SF, EA, etc.
  pricePerUnit: decimal("price_per_unit", { precision: 12, scale: 4 }).notNull(),
  
  // Validity period
  effectiveDate: date("effective_date").notNull(),
  expirationDate: date("expiration_date"),
  
  // Source information
  sourceVendorId: varchar("source_vendor_id").references(() => crmOrganisations.id, { onDelete: "set null" }),
  region: text("region"),  // Geographic region for pricing
  
  // Metadata
  notes: text("notes"),
  createdById: varchar("created_by_id").references(() => users.id),
  
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  orgIdx: index("material_price_org_idx").on(table.organizationId),
  materialIdx: index("material_price_material_idx").on(table.materialName),
  categoryIdx: index("material_price_category_idx").on(table.materialCategory),
  effectiveDateIdx: index("material_price_effective_idx").on(table.effectiveDate),
  vendorIdx: index("material_price_vendor_idx").on(table.sourceVendorId),
}));

export const insertMaterialPriceIndexSchema = createInsertSchema(materialPriceIndex).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertMaterialPriceIndex = z.infer<typeof insertMaterialPriceIndexSchema>;
export type MaterialPriceIndex = typeof materialPriceIndex.$inferSelect;

// Crew Marketplace table - Labor/crew availability listings
export const crewMarketplace = pgTable("crew_marketplace", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  crewId: varchar("crew_id").references(() => crews.id, { onDelete: "set null" }),
  
  // Crew identification
  crewName: text("crew_name").notNull(),
  tradeType: tradeTypeEnum("trade_type").notNull(),
  crewSize: integer("crew_size"),
  
  // Availability
  availabilityStatus: crewAvailabilityStatusEnum("availability_status").notNull().default("AVAILABLE"),
  availableFrom: date("available_from"),
  availableTo: date("available_to"),
  
  // Rates
  hourlyRate: decimal("hourly_rate", { precision: 10, scale: 2 }),
  dailyRate: decimal("daily_rate", { precision: 10, scale: 2 }),
  
  // Location and coverage
  baseLocation: text("base_location"),  // City, State
  travelRadius: integer("travel_radius"),  // Miles willing to travel
  
  // Skills and certifications
  skills: text("skills").array(),
  certifications: text("certifications").array(),
  equipmentOwned: text("equipment_owned").array(),
  
  // Performance
  rating: decimal("rating", { precision: 3, scale: 2 }),  // 1-5 average rating
  completedProjects: integer("completed_projects").default(0),
  
  // Contact preference
  contactName: text("contact_name"),
  contactPhone: text("contact_phone"),
  contactEmail: text("contact_email"),
  
  // Description
  description: text("description"),
  
  // Visibility
  isPublic: boolean("is_public").notNull().default(true),
  
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  orgIdx: index("crew_marketplace_org_idx").on(table.organizationId),
  crewIdx: index("crew_marketplace_crew_idx").on(table.crewId),
  tradeIdx: index("crew_marketplace_trade_idx").on(table.tradeType),
  availabilityIdx: index("crew_marketplace_availability_idx").on(table.availabilityStatus),
  locationIdx: index("crew_marketplace_location_idx").on(table.baseLocation),
}));

export const insertCrewMarketplaceSchema = createInsertSchema(crewMarketplace).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertCrewMarketplace = z.infer<typeof insertCrewMarketplaceSchema>;
export type CrewMarketplace = typeof crewMarketplace.$inferSelect;

// ============================================================
// RFI (Request for Information) System
// ============================================================
export const rfis = pgTable("rfis", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  contractId: varchar("contract_id").references(() => subcontractorContracts.id, { onDelete: "set null" }),
  rfiNumber: text("rfi_number").notNull(),
  subject: text("subject").notNull(),
  question: text("question").notNull(),
  status: rfiStatusEnum("status").notNull().default("DRAFT"),
  priority: rfiPriorityEnum("priority").notNull().default("MEDIUM"),
  category: rfiCategoryEnum("category"),
  submittedById: varchar("submitted_by_id").notNull().references(() => users.id),
  submittedByName: text("submitted_by_name"),
  subcontractorId: varchar("subcontractor_id").references(() => crmOrganisations.id, { onDelete: "set null" }),
  assignedToId: varchar("assigned_to_id").references(() => users.id),
  dateSubmitted: timestamp("date_submitted"),
  dateRequired: timestamp("date_required"),
  dateAnswered: timestamp("date_answered"),
  answeredById: varchar("answered_by_id").references(() => users.id),
  answeredByName: text("answered_by_name"),
  answer: text("answer"),
  answerAttachmentsJson: text("answer_attachments_json"),
  drawingReference: text("drawing_reference"),
  specReference: text("spec_reference"),
  impactDescription: text("impact_description"),
  costImpact: boolean("cost_impact").default(false),
  scheduleImpact: boolean("schedule_impact").default(false),
  attachmentsJson: text("attachments_json"),
  linkedChangeOrderId: varchar("linked_change_order_id").references(() => changeOrders.id, { onDelete: "set null" }),
  linkedTmTicketId: varchar("linked_tm_ticket_id").references(() => tmTickets.id, { onDelete: "set null" }),
  linkedSubmittalId: varchar("linked_submittal_id").references(() => submittals.id, { onDelete: "set null" }),
  forwardedToId: varchar("forwarded_to_id").references(() => users.id),
  forwardedAt: timestamp("forwarded_at"),
  closedAt: timestamp("closed_at"),
  closedById: varchar("closed_by_id").references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  orgIdx: index("rfis_org_idx").on(table.organizationId),
  projectIdx: index("rfis_project_idx").on(table.projectId),
  statusIdx: index("rfis_status_idx").on(table.status),
  contractIdx: index("rfis_contract_idx").on(table.contractId),
  subIdx: index("rfis_sub_idx").on(table.subcontractorId),
}));

export const rfiActivity = pgTable("rfi_activity", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  rfiId: varchar("rfi_id").notNull().references(() => rfis.id, { onDelete: "cascade" }),
  userId: varchar("user_id").notNull().references(() => users.id),
  userName: text("user_name"),
  action: text("action").notNull(),
  comment: text("comment"),
  attachmentsJson: text("attachments_json"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  rfiIdx: index("rfi_activity_rfi_idx").on(table.rfiId),
}));

export const insertRfiSchema = createInsertSchema(rfis).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertRfi = z.infer<typeof insertRfiSchema>;
export type Rfi = typeof rfis.$inferSelect;

export const insertRfiActivitySchema = createInsertSchema(rfiActivity).omit({ id: true, createdAt: true });
export type InsertRfiActivity = z.infer<typeof insertRfiActivitySchema>;
export type RfiActivity = typeof rfiActivity.$inferSelect;

export const rfiAttachments = pgTable("rfi_attachments", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  rfiId: varchar("rfi_id").notNull().references(() => rfis.id, { onDelete: "cascade" }),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  fileName: text("file_name").notNull(),
  fileSize: integer("file_size"),
  mimeType: text("mime_type"),
  storageKey: text("storage_key").notNull(),
  uploadedById: varchar("uploaded_by_id").notNull().references(() => users.id),
  uploadedByName: text("uploaded_by_name"),
  description: text("description"),
  isAnswerAttachment: boolean("is_answer_attachment").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  rfiIdx: index("rfi_attachments_rfi_idx").on(table.rfiId),
  orgIdx: index("rfi_attachments_org_idx").on(table.organizationId),
}));

export const insertRfiAttachmentSchema = createInsertSchema(rfiAttachments).omit({ id: true, createdAt: true });
export type InsertRfiAttachment = z.infer<typeof insertRfiAttachmentSchema>;
export type RfiAttachment = typeof rfiAttachments.$inferSelect;

// ============================================================
// Document Transmittal System
// ============================================================
export const documentTransmittals = pgTable("document_transmittals", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  transmittalNumber: text("transmittal_number").notNull(),
  subject: text("subject").notNull(),
  description: text("description"),
  status: transmittalStatusEnum("status").notNull().default("DRAFT"),
  sentById: varchar("sent_by_id").notNull().references(() => users.id),
  sentByName: text("sent_by_name"),
  dateSent: timestamp("date_sent"),
  documentType: text("document_type"),
  revisionNumber: text("revision_number"),
  previousTransmittalId: varchar("previous_transmittal_id"),
  attachmentsJson: text("attachments_json"),
  recipientSubcontractorIds: text("recipient_subcontractor_ids").array(),
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  orgIdx: index("transmittals_org_idx").on(table.organizationId),
  projectIdx: index("transmittals_project_idx").on(table.projectId),
  statusIdx: index("transmittals_status_idx").on(table.status),
}));

export const transmittalRecipients = pgTable("transmittal_recipients", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  transmittalId: varchar("transmittal_id").notNull().references(() => documentTransmittals.id, { onDelete: "cascade" }),
  subcontractorId: varchar("subcontractor_id").notNull().references(() => crmOrganisations.id, { onDelete: "cascade" }),
  subcontractorName: text("subcontractor_name"),
  acknowledged: boolean("acknowledged").notNull().default(false),
  acknowledgedAt: timestamp("acknowledged_at"),
  acknowledgedById: varchar("acknowledged_by_id").references(() => users.id),
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  transmittalIdx: index("transmittal_recipients_transmittal_idx").on(table.transmittalId),
  subIdx: index("transmittal_recipients_sub_idx").on(table.subcontractorId),
}));

export const insertDocumentTransmittalSchema = createInsertSchema(documentTransmittals).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertDocumentTransmittal = z.infer<typeof insertDocumentTransmittalSchema>;
export type DocumentTransmittal = typeof documentTransmittals.$inferSelect;

export const insertTransmittalRecipientSchema = createInsertSchema(transmittalRecipients).omit({ id: true, createdAt: true });
export type InsertTransmittalRecipient = z.infer<typeof insertTransmittalRecipientSchema>;
export type TransmittalRecipient = typeof transmittalRecipients.$inferSelect;

// ============================================================
// Submittal System
// ============================================================
export const submittals = pgTable("submittals", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  contractId: varchar("contract_id").references(() => subcontractorContracts.id, { onDelete: "set null" }),
  submittalNumber: text("submittal_number").notNull(),
  subject: text("subject").notNull(),
  description: text("description"),
  submittalType: submittalTypeEnum("submittal_type").notNull().default("CONTRACTOR"),
  phase: submittalPhaseEnum("phase").notNull().default("CONSTRUCTION"),
  status: submittalStatusEnum("status").notNull().default("DRAFT"),
  specSection: text("spec_section"),
  category: text("category"),
  submittalCategory: submittalCategoryEnum("submittal_category"),
  subcontractorId: varchar("subcontractor_id").references(() => crmOrganisations.id, { onDelete: "set null" }),
  submittedById: varchar("submitted_by_id").notNull().references(() => users.id),
  submittedByName: text("submitted_by_name"),
  dateSubmitted: timestamp("date_submitted"),
  dateRequired: timestamp("date_required"),
  reviewerId: varchar("reviewer_id").references(() => users.id),
  reviewerName: text("reviewer_name"),
  dateReviewed: timestamp("date_reviewed"),
  reviewComments: text("review_comments"),
  revisionNumber: integer("revision_number").notNull().default(1),
  previousSubmittalId: varchar("previous_submittal_id"),
  attachmentsJson: text("attachments_json"),
  stampAction: text("stamp_action"),
  linkedRfiId: varchar("linked_rfi_id").references(() => rfis.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  orgIdx: index("submittals_org_idx").on(table.organizationId),
  projectIdx: index("submittals_project_idx").on(table.projectId),
  statusIdx: index("submittals_status_idx").on(table.status),
  typeIdx: index("submittals_type_idx").on(table.submittalType),
  phaseIdx: index("submittals_phase_idx").on(table.phase),
  contractIdx: index("submittals_contract_idx").on(table.contractId),
  subIdx: index("submittals_sub_idx").on(table.subcontractorId),
}));

export const submittalActivity = pgTable("submittal_activity", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  submittalId: varchar("submittal_id").notNull().references(() => submittals.id, { onDelete: "cascade" }),
  userId: varchar("user_id").notNull().references(() => users.id),
  userName: text("user_name"),
  action: text("action").notNull(),
  comment: text("comment"),
  attachmentsJson: text("attachments_json"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  submittalIdx: index("submittal_activity_submittal_idx").on(table.submittalId),
}));

export const insertSubmittalSchema = createInsertSchema(submittals).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertSubmittal = z.infer<typeof insertSubmittalSchema>;
export type Submittal = typeof submittals.$inferSelect;

export const insertSubmittalActivitySchema = createInsertSchema(submittalActivity).omit({ id: true, createdAt: true });
export type InsertSubmittalActivity = z.infer<typeof insertSubmittalActivitySchema>;
export type SubmittalActivity = typeof submittalActivity.$inferSelect;

export const submittalItems = pgTable("submittal_items", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  submittalId: varchar("submittal_id").notNull().references(() => submittals.id, { onDelete: "cascade" }),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  itemNumber: integer("item_number").notNull(),
  description: text("description").notNull(),
  specSection: text("spec_section"),
  submittalCategory: submittalCategoryEnum("submittal_category"),
  quantity: decimal("quantity", { precision: 10, scale: 3 }),
  unit: text("unit"),
  manufacturer: text("manufacturer"),
  modelNumber: text("model_number"),
  notes: text("notes"),
  status: text("status").notNull().default("PENDING"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  submittalIdx: index("submittal_items_submittal_idx").on(table.submittalId),
  orgIdx: index("submittal_items_org_idx").on(table.organizationId),
  statusIdx: index("submittal_items_status_idx").on(table.status),
  submittalItemNumberUnique: unique("submittal_items_submittal_item_number_unique").on(table.submittalId, table.itemNumber),
}));

export const insertSubmittalItemSchema = createInsertSchema(submittalItems).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertSubmittalItem = z.infer<typeof insertSubmittalItemSchema>;
export type SubmittalItem = typeof submittalItems.$inferSelect;

export const submittalReviews = pgTable("submittal_reviews", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  submittalId: varchar("submittal_id").notNull().references(() => submittals.id, { onDelete: "cascade" }),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  reviewerRole: submittalReviewRoleEnum("reviewer_role").notNull(),
  reviewerId: varchar("reviewer_id").references(() => users.id, { onDelete: "set null" }),
  reviewerName: text("reviewer_name").notNull(),
  sequenceOrder: integer("sequence_order").notNull(),
  status: submittalReviewStatusEnum("status").notNull().default("PENDING"),
  comments: text("comments"),
  stampAction: text("stamp_action"),
  dateAssigned: timestamp("date_assigned"),
  dateReviewed: timestamp("date_reviewed"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  submittalIdx: index("submittal_reviews_submittal_idx").on(table.submittalId),
  orgIdx: index("submittal_reviews_org_idx").on(table.organizationId),
  statusIdx: index("submittal_reviews_status_idx").on(table.status),
  seqIdx: index("submittal_reviews_seq_idx").on(table.sequenceOrder),
}));

export const insertSubmittalReviewSchema = createInsertSchema(submittalReviews).omit({ id: true, createdAt: true });
export type InsertSubmittalReview = z.infer<typeof insertSubmittalReviewSchema>;
export type SubmittalReview = typeof submittalReviews.$inferSelect;

export const submittalAttachments = pgTable("submittal_attachments", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  submittalId: varchar("submittal_id").notNull().references(() => submittals.id, { onDelete: "cascade" }),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  submittalItemId: varchar("submittal_item_id").references(() => submittalItems.id, { onDelete: "set null" }),
  submittalReviewId: varchar("submittal_review_id").references(() => submittalReviews.id, { onDelete: "set null" }),
  fileName: text("file_name").notNull(),
  fileSize: integer("file_size"),
  mimeType: text("mime_type"),
  storageKey: text("storage_key").notNull(),
  uploadedById: varchar("uploaded_by_id").notNull().references(() => users.id),
  uploadedByName: text("uploaded_by_name"),
  description: text("description"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  submittalIdx: index("submittal_attachments_submittal_idx").on(table.submittalId),
  orgIdx: index("submittal_attachments_org_idx").on(table.organizationId),
  itemIdx: index("submittal_attachments_item_idx").on(table.submittalItemId),
  reviewIdx: index("submittal_attachments_review_idx").on(table.submittalReviewId),
}));

export const insertSubmittalAttachmentSchema = createInsertSchema(submittalAttachments).omit({ id: true, createdAt: true });
export type InsertSubmittalAttachment = z.infer<typeof insertSubmittalAttachmentSchema>;
export type SubmittalAttachment = typeof submittalAttachments.$inferSelect;

// ==================== Employee Performance & Rewards System ====================

export const ratingCriteria = pgTable("rating_criteria", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description"),
  weight: decimal("weight", { precision: 5, scale: 2 }).default("1.0"),
  maxScore: integer("max_score").notNull().default(10),
  isActive: boolean("is_active").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
  kpiTemplateId: varchar("kpi_template_id").references(() => kpiTemplates.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  orgIdx: index("rating_criteria_org_idx").on(table.organizationId),
  orgNameUnique: unique("rating_criteria_org_name_unique").on(table.organizationId, table.name),
}));

export const employeeRatings = pgTable("employee_ratings", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  employeeId: varchar("employee_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  evaluatorId: varchar("evaluator_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  projectId: varchar("project_id").references(() => projects.id, { onDelete: "set null" }),
  period: text("period"),
  overallScore: decimal("overall_score", { precision: 5, scale: 2 }),
  weightedScore: decimal("weighted_score", { precision: 5, scale: 2 }),
  comments: text("comments"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  orgIdx: index("employee_ratings_org_idx").on(table.organizationId),
  employeeIdx: index("employee_ratings_employee_idx").on(table.employeeId),
  evaluatorIdx: index("employee_ratings_evaluator_idx").on(table.evaluatorId),
}));

export const ratingScores = pgTable("rating_scores", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  ratingId: varchar("rating_id").notNull().references(() => employeeRatings.id, { onDelete: "cascade" }),
  criteriaId: varchar("criteria_id").notNull().references(() => ratingCriteria.id, { onDelete: "cascade" }),
  score: decimal("score", { precision: 5, scale: 2 }).notNull(),
  comment: text("comment"),
}, (table) => ({
  ratingIdx: index("rating_scores_rating_idx").on(table.ratingId),
  ratingCriteriaUnique: unique("rating_scores_rating_criteria_unique").on(table.ratingId, table.criteriaId),
}));

export const rewardTypes = pgTable("reward_types", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description"),
  category: rewardTypeEnum("category").notNull().default("CUSTOM"),
  value: decimal("value", { precision: 10, scale: 2 }),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  orgIdx: index("reward_types_org_idx").on(table.organizationId),
  orgNameUnique: unique("reward_types_org_name_unique").on(table.organizationId, table.name),
}));

export const rewardAssignments = pgTable("reward_assignments", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  employeeId: varchar("employee_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  rewardTypeId: varchar("reward_type_id").notNull().references(() => rewardTypes.id, { onDelete: "cascade" }),
  assignedById: varchar("assigned_by_id").notNull().references(() => users.id),
  ratingId: varchar("rating_id").references(() => employeeRatings.id, { onDelete: "set null" }),
  amount: decimal("amount", { precision: 10, scale: 2 }),
  justification: text("justification"),
  expiresAt: timestamp("expires_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  orgIdx: index("reward_assignments_org_idx").on(table.organizationId),
  employeeIdx: index("reward_assignments_employee_idx").on(table.employeeId),
}));

export const insertRatingCriteriaSchema = createInsertSchema(ratingCriteria).omit({ id: true, createdAt: true });
export type InsertRatingCriteria = z.infer<typeof insertRatingCriteriaSchema>;
export type RatingCriteria = typeof ratingCriteria.$inferSelect;

export const insertEmployeeRatingSchema = createInsertSchema(employeeRatings).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertEmployeeRating = z.infer<typeof insertEmployeeRatingSchema>;
export type EmployeeRating = typeof employeeRatings.$inferSelect;

export const insertRatingScoreSchema = createInsertSchema(ratingScores).omit({ id: true });
export type InsertRatingScore = z.infer<typeof insertRatingScoreSchema>;
export type RatingScore = typeof ratingScores.$inferSelect;

export const insertRewardTypeSchema = createInsertSchema(rewardTypes).omit({ id: true, createdAt: true });
export type InsertRewardType = z.infer<typeof insertRewardTypeSchema>;
export type RewardType = typeof rewardTypes.$inferSelect;

export const insertRewardAssignmentSchema = createInsertSchema(rewardAssignments).omit({ id: true, createdAt: true });
export type InsertRewardAssignment = z.infer<typeof insertRewardAssignmentSchema>;
export type RewardAssignment = typeof rewardAssignments.$inferSelect;

// Subcontractor Portal Tokens table
export const subcontractorPortalTokens = pgTable("subcontractor_portal_tokens", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  crmOrganisationId: varchar("crm_organisation_id").notNull().references(() => crmOrganisations.id, { onDelete: "cascade" }),
  contactEmail: text("contact_email").notNull(),
  contactName: text("contact_name").notNull(),
  tokenHash: text("token_hash").notNull().unique(),
  permissions: text("permissions").array().notNull().default(sql`ARRAY['view','comment','upload','acknowledge']`),
  status: text("status").notNull().default("active"),
  expiresAt: timestamp("expires_at").notNull(),
  lastAccessedAt: timestamp("last_accessed_at"),
  invitedById: varchar("invited_by_id").references(() => users.id),
  invitedByName: text("invited_by_name"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  revokedAt: timestamp("revoked_at"),
}, (table) => ({
  organizationIdx: index("sub_portal_tokens_org_idx").on(table.organizationId),
  projectIdx: index("sub_portal_tokens_project_idx").on(table.projectId),
  crmOrgIdx: index("sub_portal_tokens_crm_org_idx").on(table.crmOrganisationId),
  tokenIdx: index("sub_portal_tokens_token_idx").on(table.tokenHash),
  statusIdx: index("sub_portal_tokens_status_idx").on(table.status),
}));

export const insertSubcontractorPortalTokenSchema = createInsertSchema(subcontractorPortalTokens).omit({ id: true, createdAt: true });
export type InsertSubcontractorPortalToken = z.infer<typeof insertSubcontractorPortalTokenSchema>;
export type SubcontractorPortalToken = typeof subcontractorPortalTokens.$inferSelect;

// Portal Activity Log table
export const portalActivityLog = pgTable("portal_activity_log", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  portalTokenId: varchar("portal_token_id").notNull().references(() => subcontractorPortalTokens.id, { onDelete: "cascade" }),
  action: text("action").notNull(),
  entityType: text("entity_type"),
  entityId: varchar("entity_id"),
  details: text("details"),
  ipAddress: text("ip_address"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  tokenIdx: index("portal_activity_log_token_idx").on(table.portalTokenId),
  actionIdx: index("portal_activity_log_action_idx").on(table.action),
  createdAtIdx: index("portal_activity_log_created_at_idx").on(table.createdAt),
}));

export const insertPortalActivityLogSchema = createInsertSchema(portalActivityLog).omit({ id: true, createdAt: true });
export type InsertPortalActivityLog = z.infer<typeof insertPortalActivityLogSchema>;
export type PortalActivityLog = typeof portalActivityLog.$inferSelect;

// Bid Document Distributions table
export const bidDocumentDistributions = pgTable("bid_document_distributions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  bidId: varchar("bid_id"),
  projectId: varchar("project_id").references(() => projects.id, { onDelete: "set null" }),
  crmOrganisationId: varchar("crm_organisation_id").notNull().references(() => crmOrganisations.id, { onDelete: "cascade" }),
  contactEmail: text("contact_email").notNull(),
  contactName: text("contact_name").notNull(),
  documentType: text("document_type").notNull(),
  documentId: varchar("document_id"),
  documentTitle: text("document_title").notNull(),
  portalTokenId: varchar("portal_token_id").references(() => subcontractorPortalTokens.id, { onDelete: "set null" }),
  status: text("status").notNull().default("sent"),
  sentAt: timestamp("sent_at").notNull().defaultNow(),
  viewedAt: timestamp("viewed_at"),
  respondedAt: timestamp("responded_at"),
  responseNotes: text("response_notes"),
  attachmentsJson: text("attachments_json"),
  messageBody: text("message_body"),
  sentById: varchar("sent_by_id").references(() => users.id),
  sentByName: text("sent_by_name"),
}, (table) => ({
  organizationIdx: index("bid_doc_dist_org_idx").on(table.organizationId),
  bidIdx: index("bid_doc_dist_bid_idx").on(table.bidId),
  crmOrgIdx: index("bid_doc_dist_crm_org_idx").on(table.crmOrganisationId),
  statusIdx: index("bid_doc_dist_status_idx").on(table.status),
  sentAtIdx: index("bid_doc_dist_sent_at_idx").on(table.sentAt),
}));

export const insertBidDocumentDistributionSchema = createInsertSchema(bidDocumentDistributions).omit({ id: true, sentAt: true });
export type InsertBidDocumentDistribution = z.infer<typeof insertBidDocumentDistributionSchema>;
export type BidDocumentDistribution = typeof bidDocumentDistributions.$inferSelect;

// ============================================================
// CLIENT PORTAL CHAT SYSTEM
// Two-way messaging between portal users (clients/subs) and project team members
// ============================================================

export const portalChatThreads = pgTable("portal_chat_threads", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  portalTokenId: varchar("portal_token_id").references(() => subcontractorPortalTokens.id, { onDelete: "cascade" }),
  clientPortalAccessId: varchar("client_portal_access_id").references(() => clientPortalAccess.id, { onDelete: "cascade" }),
  subject: text("subject").notNull(),
  category: portalChatThreadCategoryEnum("category").notNull().default("GENERAL"),
  linkedEntityType: text("linked_entity_type"),
  linkedEntityId: varchar("linked_entity_id"),
  status: portalChatThreadStatusEnum("status").notNull().default("OPEN"),
  priority: portalChatPriorityEnum("priority").notNull().default("NORMAL"),
  lastMessageAt: timestamp("last_message_at").notNull().defaultNow(),
  portalUnreadCount: integer("portal_unread_count").notNull().default(0),
  teamUnreadCount: integer("team_unread_count").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  orgIdx: index("portal_chat_threads_org_idx").on(table.organizationId),
  projectIdx: index("portal_chat_threads_project_idx").on(table.projectId),
  portalTokenIdx: index("portal_chat_threads_token_idx").on(table.portalTokenId),
  statusIdx: index("portal_chat_threads_status_idx").on(table.status),
  lastMessageIdx: index("portal_chat_threads_last_msg_idx").on(table.lastMessageAt),
}));

export const portalChatMessages = pgTable("portal_chat_messages", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  threadId: varchar("thread_id").notNull().references(() => portalChatThreads.id, { onDelete: "cascade" }),
  senderType: text("sender_type").notNull(),
  senderPortalTokenId: varchar("sender_portal_token_id").references(() => subcontractorPortalTokens.id, { onDelete: "set null" }),
  senderClientAccessId: varchar("sender_client_access_id").references(() => clientPortalAccess.id, { onDelete: "set null" }),
  senderUserId: varchar("sender_user_id").references(() => users.id, { onDelete: "set null" }),
  senderName: text("sender_name").notNull(),
  content: text("content").notNull(),
  isInternal: boolean("is_internal").notNull().default(false),
  attachmentUrl: text("attachment_url"),
  attachmentName: text("attachment_name"),
  attachmentType: text("attachment_type"),
  readByPortal: boolean("read_by_portal").notNull().default(false),
  readByTeam: boolean("read_by_team").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  threadIdx: index("portal_chat_messages_thread_idx").on(table.threadId),
  senderTypeIdx: index("portal_chat_messages_sender_type_idx").on(table.senderType),
  createdAtIdx: index("portal_chat_messages_created_at_idx").on(table.createdAt),
}));

export const insertPortalChatThreadSchema = createInsertSchema(portalChatThreads).omit({ id: true, createdAt: true, updatedAt: true, lastMessageAt: true, portalUnreadCount: true, teamUnreadCount: true });
export type InsertPortalChatThread = z.infer<typeof insertPortalChatThreadSchema>;
export type PortalChatThread = typeof portalChatThreads.$inferSelect;

export const insertPortalChatMessageSchema = createInsertSchema(portalChatMessages).omit({ id: true, createdAt: true });
export type InsertPortalChatMessage = z.infer<typeof insertPortalChatMessageSchema>;
export type PortalChatMessage = typeof portalChatMessages.$inferSelect;

// ==================== Performance & History System ====================

export const employeePerformanceProfiles = pgTable("employee_performance_profiles", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  experienceLevel: text("experience_level"),
  productivityTendencies: text("productivity_tendencies"),
  pastProjects: text("past_projects"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertEmployeePerformanceProfileSchema = createInsertSchema(employeePerformanceProfiles).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertEmployeePerformanceProfile = z.infer<typeof insertEmployeePerformanceProfileSchema>;
export type EmployeePerformanceProfile = typeof employeePerformanceProfiles.$inferSelect;

export const attendanceLogs = pgTable("attendance_logs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  date: text("date").notNull(),
  status: text("status").notNull(),
  notes: text("notes"),
  recordedBy: varchar("recorded_by").references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertAttendanceLogSchema = createInsertSchema(attendanceLogs).omit({ id: true, createdAt: true });
export type InsertAttendanceLog = z.infer<typeof insertAttendanceLogSchema>;
export type AttendanceLog = typeof attendanceLogs.$inferSelect;

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

export const performanceReviews = pgTable("performance_reviews", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  reviewDate: text("review_date").notNull(),
  reviewerName: text("reviewer_name").notNull(),
  overallRating: integer("overall_rating").notNull(),
  productivityRating: integer("productivity_rating"),
  qualityRating: integer("quality_rating"),
  safetyRating: integer("safety_rating"),
  communicationRating: integer("communication_rating"),
  leadershipRating: integer("leadership_rating"),
  notes: text("notes"),
  scheduleAdherence: text("schedule_adherence"),
  costControl: text("cost_control"),
  subcontractorCoordination: text("subcontractor_coordination"),
  clientInspectionOutcomes: text("client_inspection_outcomes"),
  recordedBy: varchar("recorded_by").references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertPerformanceReviewSchema = createInsertSchema(performanceReviews).omit({ id: true, createdAt: true });
export type InsertPerformanceReview = z.infer<typeof insertPerformanceReviewSchema>;
export type PerformanceReview = typeof performanceReviews.$inferSelect;

export const peerRatings = pgTable("peer_ratings", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  raterId: varchar("rater_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  rateeId: varchar("ratee_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  projectId: varchar("project_id").references(() => projects.id, { onDelete: "set null" }),
  crewId: varchar("crew_id").references(() => crews.id, { onDelete: "set null" }),
  period: text("period").notNull(),
  teamwork: integer("teamwork").notNull(),
  reliability: integer("reliability").notNull(),
  communication: integer("communication").notNull(),
  helpfulness: integer("helpfulness").notNull(),
  comment: text("comment"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  orgIdx: index("peer_ratings_org_idx").on(table.organizationId),
  rateeIdx: index("peer_ratings_ratee_idx").on(table.rateeId),
  raterIdx: index("peer_ratings_rater_idx").on(table.raterId),
  // uniqueRating enforced via raw SQL index peer_ratings_unique_v3:
  // UNIQUE(organization_id, rater_id, ratee_id, COALESCE(project_id, ''), period)
}));

export const insertPeerRatingSchema = createInsertSchema(peerRatings).omit({ id: true, createdAt: true });
export type InsertPeerRating = z.infer<typeof insertPeerRatingSchema>;
export type PeerRating = typeof peerRatings.$inferSelect;

export const supervisorNotes = pgTable("supervisor_notes", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  note: text("note").notNull(),
  createdBy: varchar("created_by").references(() => users.id),
  createdByName: text("created_by_name").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertSupervisorNoteSchema = createInsertSchema(supervisorNotes).omit({ id: true, createdAt: true });
export type InsertSupervisorNote = z.infer<typeof insertSupervisorNoteSchema>;
export type SupervisorNote = typeof supervisorNotes.$inferSelect;

export const workerLogs = pgTable("worker_logs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  date: text("date").notNull(),
  note: text("note").notNull(),
  category: text("category").notNull().default("GENERAL"),
  createdBy: varchar("created_by").references(() => users.id),
  createdByName: text("created_by_name").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertWorkerLogSchema = createInsertSchema(workerLogs).omit({ id: true, createdAt: true });
export type InsertWorkerLog = z.infer<typeof insertWorkerLogSchema>;
export type WorkerLog = typeof workerLogs.$inferSelect;

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
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  orgIdx: index("ai_action_audit_org_idx").on(table.organizationId),
  actorIdx: index("ai_action_audit_actor_idx").on(table.actorUserId),
  actionTypeIdx: index("ai_action_audit_action_type_idx").on(table.actionType),
  createdAtIdx: index("ai_action_audit_created_at_idx").on(table.createdAt),
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

// Table 8: project_health_snapshots
export const projectHealthSnapshots = pgTable("project_health_snapshots", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  overallScore: integer("overall_score").notNull(),
  scheduleScore: integer("schedule_score").notNull(),
  budgetScore: integer("budget_score").notNull(),
  rfiSubmittalScore: integer("rfi_submittal_score").notNull(),
  changeOrderScore: integer("change_order_score").notNull(),
  safetyScore: integer("safety_score").notNull(),
  costScore: integer("cost_score"),
  complianceScore: integer("compliance_score"),
  trendDirection: text("trend_direction"),
  aiExplanation: text("ai_explanation"),
  breakdown: json("breakdown"),
  snapshotDate: date("snapshot_date").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  orgIdx: index("project_health_org_idx").on(table.organizationId),
  projectIdx: index("project_health_project_idx").on(table.projectId),
  dateIdx: index("project_health_date_idx").on(table.snapshotDate),
}));

export const insertProjectHealthSnapshotSchema = createInsertSchema(projectHealthSnapshots).omit({ id: true, createdAt: true });
export type InsertProjectHealthSnapshot = z.infer<typeof insertProjectHealthSnapshotSchema>;
export type ProjectHealthSnapshot = typeof projectHealthSnapshots.$inferSelect;

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

// ============================================================================
// Custom KPI Management System
// ============================================================================

export const kpiTemplates = pgTable("kpi_templates", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description"),
  category: text("category").notNull().default("Custom"),
  unit: text("unit").notNull().default("count"),
  direction: text("direction").notNull().default("higher_is_better"),
  isActive: boolean("is_active").notNull().default(true),
  createdBy: varchar("created_by").references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  orgIdx: index("kpi_templates_org_idx").on(table.organizationId),
}));

export const insertKpiTemplateSchema = createInsertSchema(kpiTemplates).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertKpiTemplate = z.infer<typeof insertKpiTemplateSchema>;
export type KpiTemplate = typeof kpiTemplates.$inferSelect;

export const kpiAssignments = pgTable("kpi_assignments", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  kpiTemplateId: varchar("kpi_template_id").notNull().references(() => kpiTemplates.id, { onDelete: "cascade" }),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  targetValue: decimal("target_value", { precision: 12, scale: 2 }).notNull(),
  periodType: text("period_type").notNull().default("monthly"),
  startDate: date("start_date").notNull(),
  endDate: date("end_date"),
  isActive: boolean("is_active").notNull().default(true),
  assignedBy: varchar("assigned_by").references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  orgIdx: index("kpi_assignments_org_idx").on(table.organizationId),
  userIdx: index("kpi_assignments_user_idx").on(table.userId),
  templateIdx: index("kpi_assignments_template_idx").on(table.kpiTemplateId),
}));

export const insertKpiAssignmentSchema = createInsertSchema(kpiAssignments).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertKpiAssignment = z.infer<typeof insertKpiAssignmentSchema>;
export type KpiAssignment = typeof kpiAssignments.$inferSelect;

export const kpiEntries = pgTable("kpi_entries", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  kpiAssignmentId: varchar("kpi_assignment_id").notNull().references(() => kpiAssignments.id, { onDelete: "cascade" }),
  actualValue: decimal("actual_value", { precision: 12, scale: 2 }).notNull(),
  periodStart: date("period_start").notNull(),
  periodEnd: date("period_end").notNull(),
  notes: text("notes"),
  source: varchar("source", { length: 10 }).notNull().default("manual"),
  recordedBy: varchar("recorded_by").references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  orgIdx: index("kpi_entries_org_idx").on(table.organizationId),
  assignmentIdx: index("kpi_entries_assignment_idx").on(table.kpiAssignmentId),
  periodIdx: index("kpi_entries_period_idx").on(table.periodStart, table.periodEnd),
}));

export const insertKpiEntrySchema = createInsertSchema(kpiEntries).omit({ id: true, createdAt: true });
export type InsertKpiEntry = z.infer<typeof insertKpiEntrySchema>;
export type KpiEntry = typeof kpiEntries.$inferSelect;

export const socialAccounts = pgTable("social_accounts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  platform: socialPlatformEnum("platform").notNull(),
  accountName: text("account_name"),
  accountId: text("account_id"),
  profileImageUrl: text("profile_image_url"),
  status: socialAccountStatusEnum("status").notNull().default("DISCONNECTED"),
  accessTokenEncrypted: text("access_token_encrypted"),
  refreshTokenEncrypted: text("refresh_token_encrypted"),
  tokenExpiresAt: timestamp("token_expires_at"),
  permissionScopes: text("permission_scopes").array(),
  lastSyncAt: timestamp("last_sync_at"),
  lastSyncError: text("last_sync_error"),
  metadata: json("metadata"),
  connectedById: varchar("connected_by_id").references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  orgIdx: index("social_accounts_org_idx").on(table.organizationId),
  platformIdx: index("social_accounts_platform_idx").on(table.platform),
}));

export const insertSocialAccountSchema = createInsertSchema(socialAccounts).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertSocialAccount = z.infer<typeof insertSocialAccountSchema>;
export type SocialAccount = typeof socialAccounts.$inferSelect;

export const socialMediaPosts = pgTable("social_media_posts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  title: text("title"),
  content: text("content").notNull(),
  platform: socialPlatformEnum("platform"),
  platforms: json("platforms"),
  status: socialPostStatusEnum("status").notNull().default("DRAFT"),
  mediaUrls: text("media_urls").array(),
  hashtags: text("hashtags").array(),
  scheduledAt: timestamp("scheduled_at"),
  publishedAt: timestamp("published_at"),
  campaignTag: text("campaign_tag"),
  tone: text("tone"),
  notes: text("notes"),
  isRecurring: boolean("is_recurring").default(false),
  recurringPattern: json("recurring_pattern"),
  socialAccountId: varchar("social_account_id").references(() => socialAccounts.id),
  aiGenerated: boolean("ai_generated").default(false),
  aiPrompt: text("ai_prompt"),
  suggestedImagePrompt: text("suggested_image_prompt"),
  externalPostId: text("external_post_id"),
  externalPostUrl: text("external_post_url"),
  retryCount: integer("retry_count").default(0),
  lastError: text("last_error"),
  utmSource: text("utm_source"),
  utmMedium: text("utm_medium"),
  utmCampaign: text("utm_campaign"),
  approvalStatus: text("approval_status"),
  rejectionReason: text("rejection_reason"),
  approvedById: varchar("approved_by_id").references(() => users.id),
  approvedAt: timestamp("approved_at"),
  createdById: varchar("created_by_id").references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  orgIdx: index("social_media_posts_org_idx").on(table.organizationId),
  statusIdx: index("social_media_posts_status_idx").on(table.status),
  scheduledIdx: index("social_media_posts_scheduled_idx").on(table.scheduledAt),
  campaignIdx: index("social_media_posts_campaign_idx").on(table.campaignTag),
}));

export const insertSocialMediaPostSchema = createInsertSchema(socialMediaPosts).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertSocialMediaPost = z.infer<typeof insertSocialMediaPostSchema>;
export type SocialMediaPost = typeof socialMediaPosts.$inferSelect;

export const socialPostAnalytics = pgTable("social_post_analytics", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  postId: varchar("post_id").notNull().references(() => socialMediaPosts.id, { onDelete: "cascade" }),
  impressions: integer("impressions").default(0),
  reach: integer("reach").default(0),
  engagement: integer("engagement").default(0),
  clicks: integer("clicks").default(0),
  likes: integer("likes").default(0),
  shares: integer("shares").default(0),
  comments: integer("comments").default(0),
  saves: integer("saves").default(0),
  fetchedAt: timestamp("fetched_at").notNull().defaultNow(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  postIdx: index("social_post_analytics_post_idx").on(table.postId),
}));

export const insertSocialPostAnalyticsSchema = createInsertSchema(socialPostAnalytics).omit({ id: true, createdAt: true });
export type InsertSocialPostAnalytics = z.infer<typeof insertSocialPostAnalyticsSchema>;
export type SocialPostAnalytics = typeof socialPostAnalytics.$inferSelect;

// ==========================================
// Libraries System - Items, Assemblies, Custom Libraries
// ==========================================

export const customLibraries = pgTable("custom_libraries", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 120 }).notNull(),
  description: text("description"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  orgIdx: index("custom_libraries_org_idx").on(table.organizationId),
}));

export const insertCustomLibrarySchema = createInsertSchema(customLibraries).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertCustomLibrary = z.infer<typeof insertCustomLibrarySchema>;
export type CustomLibrary = typeof customLibraries.$inferSelect;

export const libraryItems = pgTable("library_items", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 120 }).notNull(),
  itemNumber: varchar("item_number", { length: 50 }),
  measuredCoverage: doublePrecision("measured_coverage").notNull().default(1),
  unitOfMeasure: varchar("unit_of_measure", { length: 20 }).notNull(),
  purchaseCoverage: doublePrecision("purchase_coverage").notNull().default(1),
  purchaseUnit: varchar("purchase_unit", { length: 50 }).notNull(),
  description: varchar("description", { length: 255 }),
  costTypes: text("cost_types").array().notNull().default(sql`ARRAY['material']::text[]`),
  accountingCodes: json("accounting_codes"),
  unitCosts: json("unit_costs"),
  notes: text("notes"),
  libraryId: varchar("library_id").references(() => customLibraries.id, { onDelete: "set null" }),
  sourceId: varchar("source_id"),
  isPrebuilt: boolean("is_prebuilt").notNull().default(false),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  orgIdx: index("library_items_org_idx").on(table.organizationId),
  libraryIdx: index("library_items_library_idx").on(table.libraryId),
}));

export const insertLibraryItemSchema = createInsertSchema(libraryItems).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertLibraryItem = z.infer<typeof insertLibraryItemSchema>;
export type LibraryItem = typeof libraryItems.$inferSelect;

export const libraryAssemblies = pgTable("library_assemblies", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 120 }).notNull(),
  assemblyNumber: varchar("assembly_number", { length: 50 }),
  unitOfMeasure: varchar("unit_of_measure", { length: 20 }).notNull(),
  description: varchar("description", { length: 255 }),
  libraryId: varchar("library_id").references(() => customLibraries.id, { onDelete: "set null" }),
  sourceId: varchar("source_id"),
  isPrebuilt: boolean("is_prebuilt").notNull().default(false),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  orgIdx: index("library_assemblies_org_idx").on(table.organizationId),
  libraryIdx: index("library_assemblies_library_idx").on(table.libraryId),
}));

export const insertLibraryAssemblySchema = createInsertSchema(libraryAssemblies).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertLibraryAssembly = z.infer<typeof insertLibraryAssemblySchema>;
export type LibraryAssembly = typeof libraryAssemblies.$inferSelect;

export const libraryAssemblyItems = pgTable("library_assembly_items", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  assemblyId: varchar("assembly_id").notNull().references(() => libraryAssemblies.id, { onDelete: "cascade" }),
  itemId: varchar("item_id").references(() => libraryItems.id, { onDelete: "set null" }),
  name: text("name").notNull(),
  formula: text("formula").notNull().default("1"),
  wasteFactor: doublePrecision("waste_factor").notNull().default(0),
  unitCost: decimal("unit_cost", { precision: 10, scale: 2 }),
  unit: varchar("unit", { length: 20 }),
  displayOrder: integer("display_order").notNull().default(0),
}, (table) => ({
  assemblyIdx: index("library_assembly_items_assembly_idx").on(table.assemblyId),
}));

export const insertLibraryAssemblyItemSchema = createInsertSchema(libraryAssemblyItems).omit({ id: true });
export type InsertLibraryAssemblyItem = z.infer<typeof insertLibraryAssemblyItemSchema>;
export type LibraryAssemblyItem = typeof libraryAssemblyItems.$inferSelect;

export const libraryAssemblyItemGroups = pgTable("library_assembly_item_groups", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  assemblyId: varchar("assembly_id").notNull().references(() => libraryAssemblies.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 120 }).notNull(),
  description: text("description"),
  displayOrder: integer("display_order").notNull().default(0),
}, (table) => ({
  assemblyIdx: index("library_assembly_item_groups_assembly_idx").on(table.assemblyId),
}));

export const insertLibraryAssemblyItemGroupSchema = createInsertSchema(libraryAssemblyItemGroups).omit({ id: true });
export type InsertLibraryAssemblyItemGroup = z.infer<typeof insertLibraryAssemblyItemGroupSchema>;
export type LibraryAssemblyItemGroup = typeof libraryAssemblyItemGroups.$inferSelect;

export const libraryAssemblyItemGroupMembers = pgTable("library_assembly_item_group_members", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  groupId: varchar("group_id").notNull().references(() => libraryAssemblyItemGroups.id, { onDelete: "cascade" }),
  itemId: varchar("item_id").references(() => libraryItems.id, { onDelete: "set null" }),
  name: text("name").notNull(),
  formula: text("formula").notNull().default("1"),
  displayOrder: integer("display_order").notNull().default(0),
}, (table) => ({
  groupIdx: index("library_assembly_group_members_group_idx").on(table.groupId),
}));

export const insertLibraryAssemblyItemGroupMemberSchema = createInsertSchema(libraryAssemblyItemGroupMembers).omit({ id: true });
export type InsertLibraryAssemblyItemGroupMember = z.infer<typeof insertLibraryAssemblyItemGroupMemberSchema>;
export type LibraryAssemblyItemGroupMember = typeof libraryAssemblyItemGroupMembers.$inferSelect;

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

// ─── Project Profitability Snapshots ─────────────────────────────────────────
export const projectProfitabilitySnapshots = pgTable("project_profitability_snapshots", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  projectCode: varchar("project_code").notNull(),
  budget: decimal("budget", { precision: 12, scale: 2 }).notNull().default("0"),
  adjustedBudget: decimal("adjusted_budget", { precision: 12, scale: 2 }).notNull().default("0"),
  totalLaborCost: decimal("total_labor_cost", { precision: 12, scale: 2 }).notNull().default("0"),
  totalMaterialCost: decimal("total_material_cost", { precision: 12, scale: 2 }).notNull().default("0"),
  totalSubcontractorCost: decimal("total_subcontractor_cost", { precision: 12, scale: 2 }).notNull().default("0"),
  totalEquipmentCost: decimal("total_equipment_cost", { precision: 12, scale: 2 }).notNull().default("0"),
  totalTmCost: decimal("total_tm_cost", { precision: 12, scale: 2 }).notNull().default("0"),
  totalOtherExpenses: decimal("total_other_expenses", { precision: 12, scale: 2 }).notNull().default("0"),
  totalActualCost: decimal("total_actual_cost", { precision: 12, scale: 2 }).notNull().default("0"),
  variance: decimal("variance", { precision: 12, scale: 2 }).notNull().default("0"),
  variancePercent: decimal("variance_percent", { precision: 8, scale: 2 }).notNull().default("0"),
  estimatedMargin: decimal("estimated_margin", { precision: 12, scale: 2 }).notNull().default("0"),
  projectedCompletionCost: decimal("projected_completion_cost", { precision: 12, scale: 2 }).notNull().default("0"),
  status: text("status").notNull().default("ON_BUDGET"),
  alertThresholdFired: text("alert_threshold_fired"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  orgIdx: index("prof_snapshot_org_idx").on(table.organizationId),
  projectIdx: index("prof_snapshot_project_idx").on(table.projectId),
  createdIdx: index("prof_snapshot_created_idx").on(table.createdAt),
}));

export const insertProjectProfitabilitySnapshotSchema = createInsertSchema(projectProfitabilitySnapshots).omit({ id: true, createdAt: true });
export type InsertProjectProfitabilitySnapshot = z.infer<typeof insertProjectProfitabilitySnapshotSchema>;
export type ProjectProfitabilitySnapshot = typeof projectProfitabilitySnapshots.$inferSelect;

// ============================================
// Object ACL Policy mirror (resilience fallback for GCS metadata)
// ============================================
export const objectAclPolicies = pgTable("object_acl_policies", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  objectKey: text("object_key").notNull().unique(),
  owner: text("owner").notNull(),
  organizationId: text("organization_id").notNull(),
  visibility: text("visibility").notNull().default("private"),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  objectKeyIdx: index("object_acl_policies_object_key_idx").on(table.objectKey),
  orgIdx: index("object_acl_policies_org_idx").on(table.organizationId),
}));

export const insertObjectAclPolicySchema = createInsertSchema(objectAclPolicies).omit({ id: true, updatedAt: true });
export type InsertObjectAclPolicy = z.infer<typeof insertObjectAclPolicySchema>;
export type ObjectAclPolicyRecord = typeof objectAclPolicies.$inferSelect;

// ============================================
// HIRING MODULE TABLES
// ============================================

export const hiringJobs = pgTable("hiring_jobs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  externalProvider: atsProviderEnum("external_provider"),
  externalJobId: text("external_job_id"),
  title: text("title").notNull(),
  department: text("department"),
  trade: text("trade"),
  employmentType: hiringEmploymentTypeEnum("employment_type"),
  location: text("location"),
  compensationType: hiringCompensationTypeEnum("compensation_type"),
  compensationMin: decimal("compensation_min", { precision: 12, scale: 2 }),
  compensationMax: decimal("compensation_max", { precision: 12, scale: 2 }),
  description: text("description"),
  requirements: text("requirements"),
  preferredQualifications: text("preferred_qualifications"),
  certificationsRequired: text("certifications_required"),
  screeningQuestionsJson: text("screening_questions_json"),
  postingDestinationsJson: text("posting_destinations_json"),
  internalNotes: text("internal_notes"),
  status: hiringJobStatusEnum("status").notNull().default("DRAFT"),
  assignedOwnerUserId: varchar("assigned_owner_user_id").references(() => users.id, { onDelete: "set null" }),
  createdByUserId: varchar("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
  updatedByUserId: varchar("updated_by_user_id").references(() => users.id, { onDelete: "set null" }),
  publishedAt: timestamp("published_at"),
  archivedAt: timestamp("archived_at"),
  lastSyncedAt: timestamp("last_synced_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  orgIdx: index("hiring_jobs_org_idx").on(table.organizationId),
  statusIdx: index("hiring_jobs_status_idx").on(table.status),
  externalIdx: index("hiring_jobs_external_idx").on(table.externalJobId),
}));

export const insertHiringJobSchema = createInsertSchema(hiringJobs).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertHiringJob = z.infer<typeof insertHiringJobSchema>;
export type HiringJob = typeof hiringJobs.$inferSelect;

export const hiringJobTemplates = pgTable("hiring_job_templates", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  trade: text("trade"),
  employmentType: hiringEmploymentTypeEnum("employment_type"),
  description: text("description"),
  requirements: text("requirements"),
  certificationsRequired: text("certifications_required"),
  screeningQuestionsJson: text("screening_questions_json"),
  isGlobal: boolean("is_global").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  orgIdx: index("hiring_job_templates_org_idx").on(table.organizationId),
  globalIdx: index("hiring_job_templates_global_idx").on(table.isGlobal),
}));

export const insertHiringJobTemplateSchema = createInsertSchema(hiringJobTemplates).omit({ id: true, createdAt: true });
export type InsertHiringJobTemplate = z.infer<typeof insertHiringJobTemplateSchema>;
export type HiringJobTemplate = typeof hiringJobTemplates.$inferSelect;

export const hiringCandidates = pgTable("hiring_candidates", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  jobId: varchar("job_id").references(() => hiringJobs.id, { onDelete: "cascade" }),
  externalProvider: atsProviderEnum("external_provider"),
  externalCandidateId: text("external_candidate_id"),
  firstName: text("first_name").notNull(),
  lastName: text("last_name").notNull(),
  fullName: text("full_name").notNull(),
  email: text("email"),
  phone: text("phone"),
  city: text("city"),
  state: text("state"),
  source: text("source"),
  currentStage: text("current_stage").notNull().default("APPLIED"),
  appliedAt: timestamp("applied_at").notNull().defaultNow(),
  reviewerUserId: varchar("reviewer_user_id").references(() => users.id, { onDelete: "set null" }),
  aiScore: integer("ai_score"),
  aiRecommendation: text("ai_recommendation"),
  status: text("status").notNull().default("active"),
  rawPayloadJson: text("raw_payload_json"),
  resumeStorageKey: text("resume_storage_key"),
  applicationAnswersJson: text("application_answers_json"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  orgIdx: index("hiring_candidates_org_idx").on(table.organizationId),
  jobIdx: index("hiring_candidates_job_idx").on(table.jobId),
  stageIdx: index("hiring_candidates_stage_idx").on(table.currentStage),
  appliedAtIdx: index("hiring_candidates_applied_at_idx").on(table.appliedAt),
  reviewerIdx: index("hiring_candidates_reviewer_idx").on(table.reviewerUserId),
  externalIdx: index("hiring_candidates_external_idx").on(table.externalCandidateId),
}));

export const insertHiringCandidateSchema = createInsertSchema(hiringCandidates).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertHiringCandidate = z.infer<typeof insertHiringCandidateSchema>;
export type HiringCandidate = typeof hiringCandidates.$inferSelect;

export const hiringCandidateDocuments = pgTable("hiring_candidate_documents", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  candidateId: varchar("candidate_id").notNull().references(() => hiringCandidates.id, { onDelete: "cascade" }),
  fileName: text("file_name").notNull(),
  fileSize: integer("file_size"),
  mimeType: text("mime_type"),
  storageKey: text("storage_key").notNull(),
  uploadedByUserId: varchar("uploaded_by_user_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  candidateIdx: index("hiring_candidate_documents_candidate_idx").on(table.candidateId),
  orgIdx: index("hiring_candidate_documents_org_idx").on(table.organizationId),
}));

export const insertHiringCandidateDocumentSchema = createInsertSchema(hiringCandidateDocuments).omit({ id: true, createdAt: true });
export type InsertHiringCandidateDocument = z.infer<typeof insertHiringCandidateDocumentSchema>;
export type HiringCandidateDocument = typeof hiringCandidateDocuments.$inferSelect;

export const hiringCandidateNotes = pgTable("hiring_candidate_notes", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  candidateId: varchar("candidate_id").notNull().references(() => hiringCandidates.id, { onDelete: "cascade" }),
  authorUserId: varchar("author_user_id").references(() => users.id, { onDelete: "set null" }),
  authorName: text("author_name").notNull(),
  body: text("body").notNull(),
  isInternal: boolean("is_internal").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  candidateIdx: index("hiring_candidate_notes_candidate_idx").on(table.candidateId),
  orgIdx: index("hiring_candidate_notes_org_idx").on(table.organizationId),
}));

export const insertHiringCandidateNoteSchema = createInsertSchema(hiringCandidateNotes).omit({ id: true, createdAt: true });
export type InsertHiringCandidateNote = z.infer<typeof insertHiringCandidateNoteSchema>;
export type HiringCandidateNote = typeof hiringCandidateNotes.$inferSelect;

export const hiringCandidateStageHistory = pgTable("hiring_candidate_stage_history", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  candidateId: varchar("candidate_id").notNull().references(() => hiringCandidates.id, { onDelete: "cascade" }),
  fromStage: text("from_stage"),
  toStage: text("to_stage").notNull(),
  changedByUserId: varchar("changed_by_user_id").references(() => users.id, { onDelete: "set null" }),
  changedByName: text("changed_by_name"),
  reason: text("reason"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  candidateIdx: index("hiring_candidate_stage_history_candidate_idx").on(table.candidateId),
  orgIdx: index("hiring_candidate_stage_history_org_idx").on(table.organizationId),
}));

export const insertHiringCandidateStageHistorySchema = createInsertSchema(hiringCandidateStageHistory).omit({ id: true, createdAt: true });
export type InsertHiringCandidateStageHistory = z.infer<typeof insertHiringCandidateStageHistorySchema>;
export type HiringCandidateStageHistory = typeof hiringCandidateStageHistory.$inferSelect;

export const hiringInterviews = pgTable("hiring_interviews", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  candidateId: varchar("candidate_id").notNull().references(() => hiringCandidates.id, { onDelete: "cascade" }),
  jobId: varchar("job_id").references(() => hiringJobs.id, { onDelete: "set null" }),
  interviewType: text("interview_type").notNull().default("PHONE_SCREEN"),
  startAt: timestamp("start_at"),
  endAt: timestamp("end_at"),
  timezone: text("timezone").notNull().default("America/New_York"),
  location: text("location"),
  videoLink: text("video_link"),
  interviewerUserIdsJson: text("interviewer_user_ids_json"),
  status: hiringInterviewStatusEnum("status").notNull().default("SCHEDULED"),
  notes: text("notes"),
  reminderSentAt: timestamp("reminder_sent_at"),
  createdByUserId: varchar("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
  updatedByUserId: varchar("updated_by_user_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  candidateIdx: index("hiring_interviews_candidate_idx").on(table.candidateId),
  orgIdx: index("hiring_interviews_org_idx").on(table.organizationId),
  statusIdx: index("hiring_interviews_status_idx").on(table.status),
  startAtIdx: index("hiring_interviews_start_at_idx").on(table.startAt),
}));

export const insertHiringInterviewSchema = createInsertSchema(hiringInterviews).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertHiringInterview = z.infer<typeof insertHiringInterviewSchema>;
export type HiringInterview = typeof hiringInterviews.$inferSelect;

export const hiringTasks = pgTable("hiring_tasks", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  candidateId: varchar("candidate_id").references(() => hiringCandidates.id, { onDelete: "cascade" }),
  jobId: varchar("job_id").references(() => hiringJobs.id, { onDelete: "set null" }),
  title: text("title").notNull(),
  description: text("description"),
  assignedUserId: varchar("assigned_user_id").references(() => users.id, { onDelete: "set null" }),
  dueDate: timestamp("due_date"),
  completedAt: timestamp("completed_at"),
  status: text("status").notNull().default("open"),
  createdByUserId: varchar("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  orgIdx: index("hiring_tasks_org_idx").on(table.organizationId),
  candidateIdx: index("hiring_tasks_candidate_idx").on(table.candidateId),
  statusIdx: index("hiring_tasks_status_idx").on(table.status),
}));

export const insertHiringTaskSchema = createInsertSchema(hiringTasks).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertHiringTask = z.infer<typeof insertHiringTaskSchema>;
export type HiringTask = typeof hiringTasks.$inferSelect;

export const hiringIntegrations = pgTable("hiring_integrations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  providerName: atsProviderEnum("provider_name").notNull(),
  encryptedCredentialsJson: text("encrypted_credentials_json"),
  status: text("status").notNull().default("disconnected"),
  lastSyncAt: timestamp("last_sync_at"),
  lastTestAt: timestamp("last_test_at"),
  defaultConfigJson: text("default_config_json"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  orgIdx: index("hiring_integrations_org_idx").on(table.organizationId),
  providerIdx: index("hiring_integrations_provider_idx").on(table.providerName),
}));

export const insertHiringIntegrationSchema = createInsertSchema(hiringIntegrations).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertHiringIntegration = z.infer<typeof insertHiringIntegrationSchema>;
export type HiringIntegration = typeof hiringIntegrations.$inferSelect;

export const hiringSyncLogs = pgTable("hiring_sync_logs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  integrationId: varchar("integration_id").references(() => hiringIntegrations.id, { onDelete: "set null" }),
  provider: atsProviderEnum("provider"),
  status: hiringSyncStatusEnum("status").notNull().default("PENDING"),
  entityType: text("entity_type"),
  recordsProcessed: integer("records_processed").notNull().default(0),
  recordsFailed: integer("records_failed").notNull().default(0),
  errorSummary: text("error_summary"),
  startedAt: timestamp("started_at").notNull().defaultNow(),
  completedAt: timestamp("completed_at"),
}, (table) => ({
  orgIdx: index("hiring_sync_logs_org_idx").on(table.organizationId),
  statusIdx: index("hiring_sync_logs_status_idx").on(table.status),
  startedAtIdx: index("hiring_sync_logs_started_at_idx").on(table.startedAt),
}));

export const insertHiringSyncLogSchema = createInsertSchema(hiringSyncLogs).omit({ id: true });
export type InsertHiringSyncLog = z.infer<typeof insertHiringSyncLogSchema>;
export type HiringSyncLog = typeof hiringSyncLogs.$inferSelect;

export const hiringAiReviews = pgTable("hiring_ai_reviews", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  candidateId: varchar("candidate_id").notNull().references(() => hiringCandidates.id, { onDelete: "cascade" }),
  modelName: text("model_name").notNull(),
  score: integer("score"),
  summary: text("summary"),
  strengthsJson: text("strengths_json"),
  concernsJson: text("concerns_json"),
  extractedSkillsJson: text("extracted_skills_json"),
  extractedCertsJson: text("extracted_certs_json"),
  extractedEquipmentJson: text("extracted_equipment_json"),
  tradeFitScore: integer("trade_fit_score"),
  roleFitScore: integer("role_fit_score"),
  redFlagsJson: text("red_flags_json"),
  recommendation: text("recommendation"),
  interviewRecommendation: text("interview_recommendation"),
  confidenceScore: integer("confidence_score"),
  promptVersion: text("prompt_version"),
  generatedAt: timestamp("generated_at").notNull().defaultNow(),
}, (table) => ({
  candidateIdx: index("hiring_ai_reviews_candidate_idx").on(table.candidateId),
  orgIdx: index("hiring_ai_reviews_org_idx").on(table.organizationId),
}));

export const insertHiringAiReviewSchema = createInsertSchema(hiringAiReviews).omit({ id: true, generatedAt: true });
export type InsertHiringAiReview = z.infer<typeof insertHiringAiReviewSchema>;
export type HiringAiReview = typeof hiringAiReviews.$inferSelect;

export const hiringPipelineConfigs = pgTable("hiring_pipeline_configs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  stagesJson: text("stages_json"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  orgIdx: index("hiring_pipeline_configs_org_idx").on(table.organizationId),
}));

export const insertHiringPipelineConfigSchema = createInsertSchema(hiringPipelineConfigs).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertHiringPipelineConfig = z.infer<typeof insertHiringPipelineConfigSchema>;
export type HiringPipelineConfig = typeof hiringPipelineConfigs.$inferSelect;

export const hiringActivityLogs = pgTable("hiring_activity_logs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  actorUserId: varchar("actor_user_id").references(() => users.id, { onDelete: "set null" }),
  actorName: text("actor_name"),
  activityType: hiringActivityTypeEnum("activity_type").notNull(),
  entityType: text("entity_type"),
  entityId: varchar("entity_id"),
  entityLabel: text("entity_label"),
  metadataJson: text("metadata_json"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  orgIdx: index("hiring_activity_logs_org_idx").on(table.organizationId),
  activityTypeIdx: index("hiring_activity_logs_activity_type_idx").on(table.activityType),
  createdAtIdx: index("hiring_activity_logs_created_at_idx").on(table.createdAt),
}));

export const insertHiringActivityLogSchema = createInsertSchema(hiringActivityLogs).omit({ id: true, createdAt: true });
export type InsertHiringActivityLog = z.infer<typeof insertHiringActivityLogSchema>;
export type HiringActivityLog = typeof hiringActivityLogs.$inferSelect;

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

// ── Overhead Cost Items ──────────────────────────────────────────────────────

export const overheadCostItems = pgTable("overhead_cost_items", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  category: overheadCostCategoryEnum("category").notNull().default("OTHER"),
  amount: decimal("amount", { precision: 12, scale: 2 }).notNull(),
  frequency: overheadCostFrequencyEnum("frequency").notNull().default("MONTHLY"),
  amortizationMonths: integer("amortization_months"),
  effectiveDate: date("effective_date"),
  endDate: date("end_date"),
  isActive: boolean("is_active").notNull().default(true),
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  orgIdx: index("overhead_cost_items_org_idx").on(table.organizationId),
  activeIdx: index("overhead_cost_items_active_idx").on(table.organizationId, table.isActive),
}));

export const insertOverheadCostItemSchema = createInsertSchema(overheadCostItems).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertOverheadCostItem = z.infer<typeof insertOverheadCostItemSchema>;
export type OverheadCostItem = typeof overheadCostItems.$inferSelect;

export const overheadCostHistory = pgTable("overhead_cost_history", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  costItemId: varchar("cost_item_id"),
  action: overheadCostActionEnum("action").notNull(),
  performedById: varchar("performed_by_id").references(() => users.id),
  itemName: text("item_name").notNull(),
  previousData: text("previous_data"),
  newData: text("new_data"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  orgIdx: index("overhead_cost_history_org_idx").on(table.organizationId),
  createdAtIdx: index("overhead_cost_history_created_at_idx").on(table.createdAt),
}));

export const insertOverheadCostHistorySchema = createInsertSchema(overheadCostHistory).omit({
  id: true,
  createdAt: true,
});
export type InsertOverheadCostHistory = z.infer<typeof insertOverheadCostHistorySchema>;
export type OverheadCostHistoryEntry = typeof overheadCostHistory.$inferSelect;

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

// ==================================================
// TALENT POOL TABLES
// ==================================================

export const talentProfiles = pgTable("talent_profiles", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "set null" }),
  bio: text("bio"),
  tradeSpecialization: text("trade_specialization"),
  yearsOfExperience: integer("years_of_experience"),
  availability: talentAvailabilityEnum("availability").notNull().default("AVAILABLE"),
  visibility: talentProfileVisibilityEnum("visibility").notNull().default("PUBLIC"),
  desiredPayMin: decimal("desired_pay_min", { precision: 10, scale: 2 }),
  desiredPayMax: decimal("desired_pay_max", { precision: 10, scale: 2 }),
  payType: text("pay_type"),
  preferredLocation: text("preferred_location"),
  workRadiusMiles: integer("work_radius_miles"),
  portfolioPhotos: text("portfolio_photos").array().default(sql`'{}'::text[]`),
  resumeUrl: text("resume_url"),
  headline: text("headline"),
  rating: decimal("rating", { precision: 3, scale: 2 }),
  isPublished: boolean("is_published").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  userIdx: index("talent_profiles_user_idx").on(table.userId),
  orgIdx: index("talent_profiles_org_idx").on(table.organizationId),
  tradeIdx: index("talent_profiles_trade_idx").on(table.tradeSpecialization),
  availabilityIdx: index("talent_profiles_availability_idx").on(table.availability),
  publishedIdx: index("talent_profiles_published_idx").on(table.isPublished),
}));

export const insertTalentProfileSchema = createInsertSchema(talentProfiles).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertTalentProfile = z.infer<typeof insertTalentProfileSchema>;
export type TalentProfile = typeof talentProfiles.$inferSelect;

// ==================================================
// HIRING PIPELINE STAGES TABLE
// ==================================================

export const hiringPipelineStages = pgTable("hiring_pipeline_stages", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  key: text("key").notNull(),
  color: text("color").notNull().default("#6b7280"),
  displayOrder: integer("display_order").notNull().default(0),
  isDefault: boolean("is_default").notNull().default(false),
  isTerminal: boolean("is_terminal").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  orgIdx: index("hiring_pipeline_stages_org_idx").on(table.organizationId),
  orderIdx: index("hiring_pipeline_stages_order_idx").on(table.organizationId, table.displayOrder),
}));

export const insertHiringPipelineStageSchema = createInsertSchema(hiringPipelineStages).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertHiringPipelineStage = z.infer<typeof insertHiringPipelineStageSchema>;
export type HiringPipelineStage = typeof hiringPipelineStages.$inferSelect;

export const passkeyCredentials = pgTable("passkey_credentials", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  credentialId: text("credential_id").notNull().unique(),
  publicKey: text("public_key").notNull(),
  counter: integer("counter").notNull().default(0),
  transports: text("transports").array(),
  deviceName: text("device_name"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  userIdx: index("passkey_credentials_user_idx").on(table.userId),
  credentialIdx: index("passkey_credentials_credential_idx").on(table.credentialId),
}));

export const insertPasskeyCredentialSchema = createInsertSchema(passkeyCredentials).omit({ id: true, createdAt: true });
export type InsertPasskeyCredential = z.infer<typeof insertPasskeyCredentialSchema>;
export type PasskeyCredential = typeof passkeyCredentials.$inferSelect;

export const contracts = pgTable("contracts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  bidId: varchar("bid_id").references(() => bids.id, { onDelete: "set null" }),
  contractNumber: text("contract_number").notNull(),
  contractType: contractTypeEnum("contract_type").notNull().default("PRIME"),
  status: contractStatusEnum("status").notNull().default("DRAFT"),
  parties: text("parties"),
  contractValue: decimal("contract_value", { precision: 14, scale: 2 }),
  effectiveDate: timestamp("effective_date"),
  expirationDate: timestamp("expiration_date"),
  paymentTerms: text("payment_terms"),
  retentionPercent: decimal("retention_percent", { precision: 5, scale: 2 }),
  insuranceRequirements: text("insurance_requirements"),
  scopeSummary: text("scope_summary"),
  keyDates: text("key_dates"),
  signatureDate: timestamp("signature_date"),
  signatoryNames: text("signatory_names"),
  executedDocumentUrl: text("executed_document_url"),
  attachmentsJson: text("attachments_json"),
  currentVersion: integer("current_version").notNull().default(1),
  createdById: varchar("created_by_id").notNull().references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  orgIdx: index("contracts_org_idx").on(table.organizationId),
  projectIdx: index("contracts_project_idx").on(table.projectId),
  statusIdx: index("contracts_status_idx").on(table.status),
}));

export const insertContractSchema = createInsertSchema(contracts).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertContract = z.infer<typeof insertContractSchema>;
export type Contract = typeof contracts.$inferSelect;

export const contractVersions = pgTable("contract_versions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  contractId: varchar("contract_id").notNull().references(() => contracts.id, { onDelete: "cascade" }),
  versionNumber: integer("version_number").notNull(),
  snapshotJson: text("snapshot_json").notNull(),
  attachmentsJson: text("attachments_json"),
  changedById: varchar("changed_by_id").notNull().references(() => users.id),
  changeNote: text("change_note"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  contractIdx: index("contract_versions_contract_idx").on(table.contractId),
  versionIdx: index("contract_versions_version_idx").on(table.contractId, table.versionNumber),
}));

export const insertContractVersionSchema = createInsertSchema(contractVersions).omit({ id: true, createdAt: true });
export type InsertContractVersion = z.infer<typeof insertContractVersionSchema>;
export type ContractVersion = typeof contractVersions.$inferSelect;

export const contractRedlines = pgTable("contract_redlines", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  contractId: varchar("contract_id").notNull().references(() => contracts.id, { onDelete: "cascade" }),
  requestedById: varchar("requested_by_id").notNull().references(() => users.id),
  description: text("description").notNull(),
  section: text("section"),
  status: contractRedlineStatusEnum("status").notNull().default("OPEN"),
  resolution: text("resolution"),
  resolvedById: varchar("resolved_by_id").references(() => users.id),
  resolvedAt: timestamp("resolved_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  contractIdx: index("contract_redlines_contract_idx").on(table.contractId),
  statusIdx: index("contract_redlines_status_idx").on(table.status),
}));

export const insertContractRedlineSchema = createInsertSchema(contractRedlines).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertContractRedline = z.infer<typeof insertContractRedlineSchema>;
export type ContractRedline = typeof contractRedlines.$inferSelect;

export const contractApprovals = pgTable("contract_approvals", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  contractId: varchar("contract_id").notNull().references(() => contracts.id, { onDelete: "cascade" }),
  reviewerId: varchar("reviewer_id").notNull().references(() => users.id),
  decision: contractApprovalDecisionEnum("decision").notNull().default("PENDING"),
  comments: text("comments"),
  decidedAt: timestamp("decided_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  contractIdx: index("contract_approvals_contract_idx").on(table.contractId),
  reviewerIdx: index("contract_approvals_reviewer_idx").on(table.reviewerId),
}));

export const insertContractApprovalSchema = createInsertSchema(contractApprovals).omit({ id: true, createdAt: true });
export type InsertContractApproval = z.infer<typeof insertContractApprovalSchema>;
export type ContractApproval = typeof contractApprovals.$inferSelect;

export const contractClauses = pgTable("contract_clauses", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  category: clauseCategoryEnum("category").notNull(),
  content: text("content").notNull(),
  isRequired: boolean("is_required").notNull().default(false),
  isDefault: boolean("is_default").notNull().default(false),
  sortOrder: integer("sort_order").notNull().default(0),
  createdById: varchar("created_by_id").notNull().references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  orgIdx: index("contract_clauses_org_idx").on(table.organizationId),
  categoryIdx: index("contract_clauses_category_idx").on(table.category),
}));

export const insertContractClauseSchema = createInsertSchema(contractClauses).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertContractClause = z.infer<typeof insertContractClauseSchema>;
export type ContractClause = typeof contractClauses.$inferSelect;

export const contractTemplates = pgTable("contract_templates", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description"),
  contractType: contractTypeEnum("contract_type").notNull().default("PRIME"),
  clauseIdsJson: text("clause_ids_json").notNull().default("[]"),
  defaultPaymentTerms: text("default_payment_terms"),
  defaultRetentionPercent: decimal("default_retention_percent", { precision: 5, scale: 2 }),
  defaultInsuranceRequirements: text("default_insurance_requirements"),
  isActive: boolean("is_active").notNull().default(true),
  createdById: varchar("created_by_id").notNull().references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  orgIdx: index("contract_templates_org_idx").on(table.organizationId),
}));

export const insertContractTemplateSchema = createInsertSchema(contractTemplates).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertContractTemplate = z.infer<typeof insertContractTemplateSchema>;
export type ContractTemplate = typeof contractTemplates.$inferSelect;

export const signatureRequests = pgTable("signature_requests", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  contractId: varchar("contract_id").notNull().references(() => contracts.id, { onDelete: "cascade" }),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  status: signatureRequestStatusEnum("status").notNull().default("PENDING"),
  signersJson: text("signers_json").notNull().default("[]"),
  message: text("message"),
  expiresAt: timestamp("expires_at"),
  completedAt: timestamp("completed_at"),
  createdById: varchar("created_by_id").notNull().references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  contractIdx: index("signature_requests_contract_idx").on(table.contractId),
  orgIdx: index("signature_requests_org_idx").on(table.organizationId),
  statusIdx: index("signature_requests_status_idx").on(table.status),
}));

export const insertSignatureRequestSchema = createInsertSchema(signatureRequests).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertSignatureRequest = z.infer<typeof insertSignatureRequestSchema>;
export type SignatureRequest = typeof signatureRequests.$inferSelect;

export const contractRiskAnalyses = pgTable("contract_risk_analyses", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  contractId: varchar("contract_id").notNull().references(() => contracts.id, { onDelete: "cascade" }),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  overallRiskScore: integer("overall_risk_score").notNull(),
  riskLevel: text("risk_level").notNull(),
  summaryText: text("summary_text").notNull(),
  clauseAnalysisJson: text("clause_analysis_json").notNull().default("[]"),
  missingProtectionsJson: text("missing_protections_json").notNull().default("[]"),
  recommendationsJson: text("recommendations_json").notNull().default("[]"),
  analyzedById: varchar("analyzed_by_id").notNull().references(() => users.id),
  analyzedAt: timestamp("analyzed_at").notNull().defaultNow(),
}, (table) => ({
  contractIdx: index("contract_risk_analyses_contract_idx").on(table.contractId),
  orgIdx: index("contract_risk_analyses_org_idx").on(table.organizationId),
}));

export type ContractRiskAnalysis = typeof contractRiskAnalyses.$inferSelect;

export const drawingSets = pgTable("drawing_sets", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description"),
  isPrimary: boolean("is_primary").notNull().default(false),
  createdByUserId: varchar("created_by_user_id").references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  projectIdx: index("drawing_sets_project_idx").on(table.projectId),
  orgIdx: index("drawing_sets_org_idx").on(table.organizationId),
}));

export const insertDrawingSetSchema = createInsertSchema(drawingSets).omit({ id: true, createdAt: true });
export type InsertDrawingSet = z.infer<typeof insertDrawingSetSchema>;
export type DrawingSet = typeof drawingSets.$inferSelect;

export const drawingSetItems = pgTable("drawing_set_items", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  drawingSetId: varchar("drawing_set_id").notNull().references(() => drawingSets.id, { onDelete: "cascade" }),
  sheetId: varchar("sheet_id").notNull().references(() => takeoffSheets.id, { onDelete: "cascade" }),
  revisionId: varchar("revision_id"),
  pinnedAt: timestamp("pinned_at").notNull().defaultNow(),
}, (table) => ({
  setIdx: index("drawing_set_items_set_idx").on(table.drawingSetId),
  sheetIdx: index("drawing_set_items_sheet_idx").on(table.sheetId),
  uniqueSetSheet: unique("drawing_set_items_set_sheet").on(table.drawingSetId, table.sheetId),
}));

export const insertDrawingSetItemSchema = createInsertSchema(drawingSetItems).omit({ id: true, pinnedAt: true });
export type InsertDrawingSetItem = z.infer<typeof insertDrawingSetItemSchema>;
export type DrawingSetItem = typeof drawingSetItems.$inferSelect;

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
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertOshaIncidentSchema = createInsertSchema(oshaIncidents).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertOshaIncident = z.infer<typeof insertOshaIncidentSchema>;
export type OshaIncident = typeof oshaIncidents.$inferSelect;

export const revenueRecognition = pgTable("revenue_recognition", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  period: text("period").notNull(),
  snapshotDate: date("snapshot_date").notNull(),
  contractValue: decimal("contract_value", { precision: 14, scale: 2 }).notNull().default("0"),
  changeOrderAdjustments: decimal("change_order_adjustments", { precision: 14, scale: 2 }).notNull().default("0"),
  adjustedContractValue: decimal("adjusted_contract_value", { precision: 14, scale: 2 }).notNull().default("0"),
  costsToDate: decimal("costs_to_date", { precision: 14, scale: 2 }).notNull().default("0"),
  estimatedTotalCost: decimal("estimated_total_cost", { precision: 14, scale: 2 }).notNull().default("0"),
  percentComplete: decimal("percent_complete", { precision: 7, scale: 4 }).notNull().default("0"),
  earnedRevenue: decimal("earned_revenue", { precision: 14, scale: 2 }).notNull().default("0"),
  billingsToDate: decimal("billings_to_date", { precision: 14, scale: 2 }).notNull().default("0"),
  overUnderBilling: decimal("over_under_billing", { precision: 14, scale: 2 }).notNull().default("0"),
  grossProfit: decimal("gross_profit", { precision: 14, scale: 2 }).notNull().default("0"),
  grossProfitPercent: decimal("gross_profit_percent", { precision: 7, scale: 4 }).notNull().default("0"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  projectIdx: index("rev_rec_project_idx").on(table.projectId),
  orgIdx: index("rev_rec_org_idx").on(table.organizationId),
  periodIdx: index("rev_rec_period_idx").on(table.period),
  snapshotIdx: index("rev_rec_snapshot_idx").on(table.snapshotDate),
}));

export const insertRevenueRecognitionSchema = createInsertSchema(revenueRecognition).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertRevenueRecognition = z.infer<typeof insertRevenueRecognitionSchema>;
export type RevenueRecognition = typeof revenueRecognition.$inferSelect;

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

export const userSettings = pgTable("user_settings", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }).unique(),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  themePreference: text("theme_preference").notNull().default("system"),
  defaultLandingPage: text("default_landing_page").notNull().default("/dashboard"),
  dateFormat: text("date_format").notNull().default("MM/DD/YYYY"),
  timeFormat: text("time_format").notNull().default("12h"),
  timezone: text("timezone"),
  tableDensity: text("table_density").notNull().default("COZY"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  userIdx: index("user_settings_user_idx").on(table.userId),
}));

export const TABLE_DENSITY_VALUES = ["COMPACT", "COZY", "COMFORTABLE"] as const;
export type TableDensity = (typeof TABLE_DENSITY_VALUES)[number];

export const insertUserSettingsSchema = createInsertSchema(userSettings).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertUserSettings = z.infer<typeof insertUserSettingsSchema>;
export type UserSettings = typeof userSettings.$inferSelect;

// Task #575: User Saved Views — per-user saved view + filter combinations
export const userSavedViews = pgTable("user_saved_views", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  viewKey: text("view_key").notNull(),
  name: text("name").notNull(),
  view: text("view").notNull(),
  filtersJson: text("filters_json").notNull().default("{}"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  userViewKeyIdx: index("user_saved_views_user_view_key_idx").on(table.userId, table.viewKey),
}));

export const insertUserSavedViewSchema = createInsertSchema(userSavedViews).omit({ id: true, createdAt: true });
export type InsertUserSavedView = z.infer<typeof insertUserSavedViewSchema>;
export type UserSavedView = typeof userSavedViews.$inferSelect;

export const activityLog = pgTable("activity_log", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  action: text("action").notNull(),
  details: text("details"),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  userIdx: index("activity_log_user_idx").on(table.userId),
  createdIdx: index("activity_log_created_idx").on(table.createdAt),
}));

export const insertActivityLogSchema = createInsertSchema(activityLog).omit({ id: true, createdAt: true });
export type InsertActivityLog = z.infer<typeof insertActivityLogSchema>;
export type ActivityLog = typeof activityLog.$inferSelect;

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

export const executiveDigests = pgTable("executive_digests", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  period: text("period").notNull(),
  generatedAt: timestamp("generated_at").notNull().defaultNow(),
  executiveSummary: text("executive_summary").notNull(),
  keyHighlights: json("key_highlights").notNull().$type<string[]>(),
  sections: json("sections").notNull().$type<{
    title: string;
    icon: string;
    summary: string;
    bullets: string[];
    sentiment: string;
  }[]>(),
  actionItems: json("action_items").notNull().$type<{
    priority: string;
    description: string;
    dueBy?: string;
  }[]>(),
  kpiSnapshot: json("kpi_snapshot").notNull().$type<{
    name: string;
    current: number;
    previous: number;
    unit: string;
    trend: string;
  }[]>(),
  generatedBy: varchar("generated_by").references(() => users.id, { onDelete: "set null" }),
}, (table) => ({
  orgPeriodIdx: index("executive_digests_org_period_idx").on(table.organizationId, table.period),
  generatedAtIdx: index("executive_digests_generated_at_idx").on(table.generatedAt),
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

export const emailCampaigns = pgTable("email_campaigns", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id),
  name: text("name").notNull(),
  subject: text("subject").notNull(),
  htmlContent: text("html_content").notNull(),
  textContent: text("text_content"),
  fromName: text("from_name"),
  replyTo: text("reply_to"),
  status: text("status").notNull().default("DRAFT"),
  scheduledAt: timestamp("scheduled_at"),
  sentAt: timestamp("sent_at"),
  totalRecipients: integer("total_recipients").default(0),
  totalSent: integer("total_sent").default(0),
  totalOpened: integer("total_opened").default(0),
  totalClicked: integer("total_clicked").default(0),
  totalBounced: integer("total_bounced").default(0),
  totalUnsubscribed: integer("total_unsubscribed").default(0),
  tags: text("tags").array(),
  createdById: varchar("created_by_id").references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  orgIdx: index("email_campaigns_org_idx").on(table.organizationId),
}));

export const insertEmailCampaignSchema = createInsertSchema(emailCampaigns).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertEmailCampaign = z.infer<typeof insertEmailCampaignSchema>;
export type EmailCampaign = typeof emailCampaigns.$inferSelect;

export const emailCampaignContacts = pgTable("email_campaign_contacts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  campaignId: varchar("campaign_id").notNull().references(() => emailCampaigns.id, { onDelete: "cascade" }),
  email: text("email").notNull(),
  name: text("name"),
  status: text("status").notNull().default("PENDING"),
  sentAt: timestamp("sent_at"),
  openedAt: timestamp("opened_at"),
  clickedAt: timestamp("clicked_at"),
  errorMessage: text("error_message"),
}, (table) => ({
  campaignIdx: index("email_campaign_contacts_campaign_idx").on(table.campaignId),
}));

export const insertEmailCampaignContactSchema = createInsertSchema(emailCampaignContacts).omit({ id: true });
export type InsertEmailCampaignContact = z.infer<typeof insertEmailCampaignContactSchema>;
export type EmailCampaignContact = typeof emailCampaignContacts.$inferSelect;

export const emailCampaignTemplates = pgTable("email_campaign_templates", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id),
  name: text("name").notNull(),
  subject: text("subject"),
  htmlContent: text("html_content").notNull(),
  category: text("category").default("GENERAL"),
  isDefault: boolean("is_default").default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  orgIdx: index("email_campaign_templates_org_idx").on(table.organizationId),
}));

export const insertEmailCampaignTemplateSchema = createInsertSchema(emailCampaignTemplates).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertEmailCampaignTemplate = z.infer<typeof insertEmailCampaignTemplateSchema>;
export type EmailCampaignTemplate = typeof emailCampaignTemplates.$inferSelect;

export const unifiedPayments = pgTable("unified_payments", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  invoiceType: invoiceTypeEnum("invoice_type").notNull(),
  invoiceId: varchar("invoice_id").notNull(),
  projectId: varchar("project_id").references(() => projects.id),
  amount: decimal("amount", { precision: 14, scale: 2 }).notNull(),
  paymentDate: date("payment_date").notNull(),
  paymentMethod: unifiedPaymentMethodEnum("payment_method").default("CHECK"),
  referenceNumber: text("reference_number"),
  notes: text("notes"),
  status: unifiedPaymentStatusEnum("status").notNull().default("ACTIVE"),
  voidedAt: timestamp("voided_at"),
  voidedById: varchar("voided_by_id").references(() => users.id),
  voidReason: text("void_reason"),
  recordedById: varchar("recorded_by_id").references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  orgIdx: index("unified_payments_org_idx").on(table.organizationId),
  invoiceIdx: index("unified_payments_invoice_idx").on(table.invoiceType, table.invoiceId),
  projectIdx: index("unified_payments_project_idx").on(table.projectId),
  statusIdx: index("unified_payments_status_idx").on(table.status),
}));

export const insertUnifiedPaymentSchema = createInsertSchema(unifiedPayments).omit({ id: true, createdAt: true, updatedAt: true, voidedAt: true, voidedById: true, voidReason: true });
export type InsertUnifiedPayment = z.infer<typeof insertUnifiedPaymentSchema>;
export type UnifiedPayment = typeof unifiedPayments.$inferSelect;

// ========================================================================
// HEAVY CIVIL & DOT COVERAGE
// Pay item libraries for FHWA + all 50+ state DOTs / territories /
// toll authorities, plus the surrounding heavy-civil tables (DBE goals,
// surety bonds, haul tickets, Daily Inspector Reports, SWPPP, Buy America).
// Pay item libraries are GLOBAL reference data (no organizationId);
// orgs may add overrides via dotPayItemOverrides.
// ========================================================================

export const dotAgencies = pgTable("dot_agencies", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  code: varchar("code", { length: 32 }).notNull().unique(),
  name: text("name").notNull(),
  fullName: text("full_name").notNull(),
  stateCode: varchar("state_code", { length: 4 }),
  kind: dotAgencyKindEnum("kind").notNull(),
  website: text("website"),
  specBookSystem: text("spec_book_system"),
  currentSpecYear: varchar("current_spec_year", { length: 8 }),
  supportsAashtoware: boolean("supports_aashtoware").notNull().default(false),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  kindIdx: index("dot_agencies_kind_idx").on(table.kind),
  stateIdx: index("dot_agencies_state_idx").on(table.stateCode),
}));
export const insertDotAgencySchema = createInsertSchema(dotAgencies).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertDotAgency = z.infer<typeof insertDotAgencySchema>;
export type DotAgency = typeof dotAgencies.$inferSelect;

export const dotSpecBooks = pgTable("dot_spec_books", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  agencyId: varchar("agency_id").notNull().references(() => dotAgencies.id, { onDelete: "cascade" }),
  edition: varchar("edition", { length: 16 }).notNull(),
  title: text("title").notNull(),
  effectiveDate: date("effective_date"),
  isCurrent: boolean("is_current").notNull().default(false),
  itemCount: integer("item_count").notNull().default(0),
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  agencyIdx: index("dot_spec_books_agency_idx").on(table.agencyId),
  uniqueEdition: unique("dot_spec_books_agency_edition_uniq").on(table.agencyId, table.edition),
}));
export const insertDotSpecBookSchema = createInsertSchema(dotSpecBooks).omit({ id: true, createdAt: true, updatedAt: true, itemCount: true });
export type InsertDotSpecBook = z.infer<typeof insertDotSpecBookSchema>;
export type DotSpecBook = typeof dotSpecBooks.$inferSelect;

export const dotPayItems = pgTable("dot_pay_items", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  specBookId: varchar("spec_book_id").notNull().references(() => dotSpecBooks.id, { onDelete: "cascade" }),
  agencyId: varchar("agency_id").notNull().references(() => dotAgencies.id, { onDelete: "cascade" }),
  itemNumber: varchar("item_number", { length: 64 }).notNull(),
  description: text("description").notNull(),
  unit: varchar("unit", { length: 16 }).notNull(),
  specSection: varchar("spec_section", { length: 32 }),
  category: text("category"),
  payItemType: dotPayItemTypeEnum("pay_item_type").notNull().default("UNIT_PRICE"),
  searchTokens: text("search_tokens"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  specBookIdx: index("dot_pay_items_spec_book_idx").on(table.specBookId),
  agencyIdx: index("dot_pay_items_agency_idx").on(table.agencyId),
  itemNumberIdx: index("dot_pay_items_item_number_idx").on(table.itemNumber),
  uniqueItem: unique("dot_pay_items_spec_book_item_uniq").on(table.specBookId, table.itemNumber),
}));
export const insertDotPayItemSchema = createInsertSchema(dotPayItems).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertDotPayItem = z.infer<typeof insertDotPayItemSchema>;
export type DotPayItem = typeof dotPayItems.$inferSelect;

// Per-organization overrides: rename, custom unit, internal alias, custom category
export const dotPayItemOverrides = pgTable("dot_pay_item_overrides", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  payItemId: varchar("pay_item_id").notNull().references(() => dotPayItems.id, { onDelete: "cascade" }),
  customDescription: text("custom_description"),
  customUnit: varchar("custom_unit", { length: 16 }),
  internalAlias: text("internal_alias"),
  customCategory: text("custom_category"),
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  uniquePerOrg: unique("dot_pay_item_overrides_org_item_uniq").on(table.organizationId, table.payItemId),
  orgIdx: index("dot_pay_item_overrides_org_idx").on(table.organizationId),
}));
export const insertDotPayItemOverrideSchema = createInsertSchema(dotPayItemOverrides).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertDotPayItemOverride = z.infer<typeof insertDotPayItemOverrideSchema>;
export type DotPayItemOverride = typeof dotPayItemOverrides.$inferSelect;

// Which DOTs an organization regularly bids in (drives onboarding & default spec book picker)
export const organizationDotPreferences = pgTable("organization_dot_preferences", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  agencyId: varchar("agency_id").notNull().references(() => dotAgencies.id, { onDelete: "cascade" }),
  isDefault: boolean("is_default").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  uniquePref: unique("org_dot_preferences_uniq").on(table.organizationId, table.agencyId),
  orgIdx: index("org_dot_preferences_org_idx").on(table.organizationId),
}));
export const insertOrganizationDotPreferenceSchema = createInsertSchema(organizationDotPreferences).omit({ id: true, createdAt: true });
export type InsertOrganizationDotPreference = z.infer<typeof insertOrganizationDotPreferenceSchema>;
export type OrganizationDotPreference = typeof organizationDotPreferences.$inferSelect;

// ============================================
// DBE / MBE / WBE / SBE / VOSB GOAL TRACKING
// ============================================
export const projectDbeGoals = pgTable("project_dbe_goals", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  certificationType: dbeCertificationTypeEnum("certification_type").notNull(),
  goalPercent: decimal("goal_percent", { precision: 5, scale: 2 }).notNull(),
  goalDollars: decimal("goal_dollars", { precision: 14, scale: 2 }),
  notes: text("notes"),
  createdById: varchar("created_by_id").references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  projectIdx: index("project_dbe_goals_project_idx").on(table.projectId),
  uniqueGoal: unique("project_dbe_goals_uniq").on(table.projectId, table.certificationType),
}));
export const insertProjectDbeGoalSchema = createInsertSchema(projectDbeGoals).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertProjectDbeGoal = z.infer<typeof insertProjectDbeGoalSchema>;
export type ProjectDbeGoal = typeof projectDbeGoals.$inferSelect;

// CRM organisation certifications (multi-cert per sub/vendor)
export const crmOrganisationCertifications = pgTable("crm_organisation_certifications", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  crmOrganisationId: varchar("crm_organisation_id").notNull().references(() => crmOrganisations.id, { onDelete: "cascade" }),
  certificationType: dbeCertificationTypeEnum("certification_type").notNull(),
  certifyingAgency: text("certifying_agency"),
  certificationNumber: text("certification_number"),
  effectiveDate: date("effective_date"),
  expirationDate: date("expiration_date"),
  documentUrl: text("document_url"),
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  orgEntityIdx: index("crm_org_cert_entity_idx").on(table.crmOrganisationId),
  expIdx: index("crm_org_cert_exp_idx").on(table.expirationDate),
  uniqueCert: unique("crm_org_cert_uniq").on(table.crmOrganisationId, table.certificationType, table.certifyingAgency),
}));
export const insertCrmOrganisationCertificationSchema = createInsertSchema(crmOrganisationCertifications).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertCrmOrganisationCertification = z.infer<typeof insertCrmOrganisationCertificationSchema>;
export type CrmOrganisationCertification = typeof crmOrganisationCertifications.$inferSelect;

// ============================================
// SURETY BONDS LEDGER
// ============================================
export const suretyBonds = pgTable("surety_bonds", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  projectId: varchar("project_id").references(() => projects.id, { onDelete: "set null" }),
  bidId: varchar("bid_id").references(() => bids.id, { onDelete: "set null" }),
  bondType: suretyBondTypeEnum("bond_type").notNull(),
  status: suretyBondStatusEnum("status").notNull().default("DRAFT"),
  bondNumber: text("bond_number").notNull(),
  suretyCompany: text("surety_company").notNull(),
  agentName: text("agent_name"),
  agentPhone: text("agent_phone"),
  agentEmail: text("agent_email"),
  bondAmount: decimal("bond_amount", { precision: 14, scale: 2 }).notNull(),
  premiumAmount: decimal("premium_amount", { precision: 12, scale: 2 }),
  effectiveDate: date("effective_date"),
  expirationDate: date("expiration_date"),
  releaseDate: date("release_date"),
  documentUrl: text("document_url"),
  documentId: varchar("document_id"),
  notes: text("notes"),
  verificationStatus: text("verification_status"),
  lastVerifiedAt: timestamp("last_verified_at"),
  createdById: varchar("created_by_id").references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  orgIdx: index("surety_bonds_org_idx").on(table.organizationId),
  projectIdx: index("surety_bonds_project_idx").on(table.projectId),
  bidIdx: index("surety_bonds_bid_idx").on(table.bidId),
  expIdx: index("surety_bonds_exp_idx").on(table.expirationDate),
  statusIdx: index("surety_bonds_status_idx").on(table.status),
}));
export const insertSuretyBondSchema = createInsertSchema(suretyBonds).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertSuretyBond = z.infer<typeof insertSuretyBondSchema>;
export type SuretyBond = typeof suretyBonds.$inferSelect;

// ============================================
// HAUL TICKETS
// ============================================
export const haulTickets = pgTable("haul_tickets", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  ticketNumber: text("ticket_number").notNull(),
  ticketDate: date("ticket_date").notNull(),
  status: haulTicketStatusEnum("status").notNull().default("SUBMITTED"),
  materialClass: text("material_class").notNull(),
  source: text("source"),
  destination: text("destination"),
  truckNumber: text("truck_number"),
  driverName: text("driver_name"),
  haulerVendorId: varchar("hauler_vendor_id").references(() => crmOrganisations.id, { onDelete: "set null" }),
  quantity: decimal("quantity", { precision: 12, scale: 3 }).notNull(),
  unit: varchar("unit", { length: 16 }).notNull().default("TON"),
  unitCost: decimal("unit_cost", { precision: 12, scale: 4 }),
  totalCost: decimal("total_cost", { precision: 14, scale: 2 }),
  costCode: varchar("cost_code", { length: 20 }),
  payItemId: varchar("pay_item_id").references(() => dotPayItems.id, { onDelete: "set null" }),
  payItemNumber: varchar("pay_item_number", { length: 64 }),
  ticketPhotoUrl: text("ticket_photo_url"),
  ticketPhotoDocumentId: varchar("ticket_photo_document_id"),
  notes: text("notes"),
  recordedById: varchar("recorded_by_id").references(() => users.id),
  approvedById: varchar("approved_by_id").references(() => users.id),
  approvedAt: timestamp("approved_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  orgIdx: index("haul_tickets_org_idx").on(table.organizationId),
  projectIdx: index("haul_tickets_project_idx").on(table.projectId),
  ticketDateIdx: index("haul_tickets_date_idx").on(table.ticketDate),
  statusIdx: index("haul_tickets_status_idx").on(table.status),
}));
export const insertHaulTicketSchema = createInsertSchema(haulTickets).omit({ id: true, createdAt: true, updatedAt: true, approvedAt: true });
export type InsertHaulTicket = z.infer<typeof insertHaulTicketSchema>;
export type HaulTicket = typeof haulTickets.$inferSelect;

// ============================================
// DAILY INSPECTOR REPORT (IDR)
// Separate from T&M tickets — a state-DOT-style daily field report
// ============================================
export const dailyInspectorReports = pgTable("daily_inspector_reports", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  reportDate: date("report_date").notNull(),
  reportNumber: text("report_number"),
  status: idrStatusEnum("status").notNull().default("DRAFT"),
  inspectorId: varchar("inspector_id").references(() => users.id),
  inspectorName: text("inspector_name"),
  weatherConditions: text("weather_conditions"),
  temperatureHigh: integer("temperature_high"),
  temperatureLow: integer("temperature_low"),
  precipitationInches: decimal("precipitation_inches", { precision: 5, scale: 2 }),
  windSpeedMph: integer("wind_speed_mph"),
  crewCount: integer("crew_count").default(0),
  crewHours: decimal("crew_hours", { precision: 8, scale: 2 }).default("0"),
  equipmentSummary: json("equipment_summary"),
  workPerformed: text("work_performed"),
  stationsWorked: text("stations_worked"),
  deliveries: text("deliveries"),
  visitors: text("visitors"),
  safetyIncidents: text("safety_incidents"),
  delaysEncountered: text("delays_encountered"),
  photoUrls: text("photo_urls").array(),
  attachmentUrls: text("attachment_urls").array(),
  photoDocumentIds: text("photo_document_ids").array(),
  attachmentDocumentIds: text("attachment_document_ids").array(),
  submittedAt: timestamp("submitted_at"),
  approvedAt: timestamp("approved_at"),
  approvedById: varchar("approved_by_id").references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  orgIdx: index("idr_org_idx").on(table.organizationId),
  projectIdx: index("idr_project_idx").on(table.projectId),
  reportDateIdx: index("idr_date_idx").on(table.reportDate),
  uniqueDay: unique("idr_project_date_uniq").on(table.projectId, table.reportDate),
}));
export const insertDailyInspectorReportSchema = createInsertSchema(dailyInspectorReports).omit({ id: true, createdAt: true, updatedAt: true, submittedAt: true, approvedAt: true });
export type InsertDailyInspectorReport = z.infer<typeof insertDailyInspectorReportSchema>;
export type DailyInspectorReport = typeof dailyInspectorReports.$inferSelect;

// ============================================
// SWPPP / NPDES INSPECTION LOG
// ============================================
export const swpppInspections = pgTable("swppp_inspections", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  inspectionDate: date("inspection_date").notNull(),
  inspectionType: swpppInspectionTypeEnum("inspection_type").notNull().default("ROUTINE"),
  inspectorId: varchar("inspector_id").references(() => users.id),
  inspectorName: text("inspector_name"),
  inspectorCertNumber: text("inspector_cert_number"),
  rainfallTriggerInches: decimal("rainfall_trigger_inches", { precision: 5, scale: 2 }),
  rainfall24hrInches: decimal("rainfall_24hr_inches", { precision: 5, scale: 2 }),
  bmpChecklist: json("bmp_checklist"),
  deficienciesFound: text("deficiencies_found"),
  correctiveActions: text("corrective_actions"),
  correctiveActionAssigneeId: varchar("corrective_action_assignee_id").references(() => users.id),
  correctiveActionDueDate: date("corrective_action_due_date"),
  correctiveActionCompletedAt: timestamp("corrective_action_completed_at"),
  photoUrls: text("photo_urls").array(),
  notes: text("notes"),
  createdById: varchar("created_by_id").references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  orgIdx: index("swppp_org_idx").on(table.organizationId),
  projectIdx: index("swppp_project_idx").on(table.projectId),
  inspectionDateIdx: index("swppp_date_idx").on(table.inspectionDate),
}));
export const insertSwpppInspectionSchema = createInsertSchema(swpppInspections).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertSwpppInspection = z.infer<typeof insertSwpppInspectionSchema>;
export type SwpppInspection = typeof swpppInspections.$inferSelect;

// ============================================
// MATERIAL CERTIFICATIONS / BUY AMERICA TRACKER
// ============================================
export const materialCertifications = pgTable("material_certifications", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  materialDescription: text("material_description").notNull(),
  payItemId: varchar("pay_item_id").references(() => dotPayItems.id, { onDelete: "set null" }),
  payItemNumber: varchar("pay_item_number", { length: 64 }),
  manufacturerName: text("manufacturer_name"),
  manufacturerCountry: text("manufacturer_country"),
  millName: text("mill_name"),
  millCountry: text("mill_country"),
  heatNumber: text("heat_number"),
  certNumber: text("cert_number"),
  buyAmericaStatus: buyAmericaStatusEnum("buy_america_status").notNull().default("PENDING"),
  waiverReason: text("waiver_reason"),
  documentUrl: text("document_url"),
  documentId: varchar("document_id"),
  receivedDate: date("received_date"),
  expirationDate: date("expiration_date"),
  submittedById: varchar("submitted_by_id").references(() => users.id),
  submittedAt: timestamp("submitted_at"),
  verifiedById: varchar("verified_by_id").references(() => users.id),
  verifiedAt: timestamp("verified_at"),
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  orgIdx: index("material_certs_org_idx").on(table.organizationId),
  projectIdx: index("material_certs_project_idx").on(table.projectId),
  statusIdx: index("material_certs_status_idx").on(table.buyAmericaStatus),
}));
export const insertMaterialCertificationSchema = createInsertSchema(materialCertifications).omit({ id: true, createdAt: true, updatedAt: true, verifiedAt: true });
export type InsertMaterialCertification = z.infer<typeof insertMaterialCertificationSchema>;
export type MaterialCertification = typeof materialCertifications.$inferSelect;


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
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  sequenceIdx: index("crm_sequence_steps_seq_idx").on(table.sequenceId),
  orderIdx: index("crm_sequence_steps_order_idx").on(table.sequenceId, table.stepOrder),
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
