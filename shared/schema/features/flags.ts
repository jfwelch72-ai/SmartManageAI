// AUTO-GENERATED SPLIT FROM shared/schema/features.ts (Task #2426).
// Domain bucketing rule lives in shared/schema/features/index.ts.
import { sql } from "drizzle-orm";
import { pgTable, text, varchar, boolean, timestamp, date, decimal, integer, pgEnum, doublePrecision, index, unique, uniqueIndex, json, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod";
import { addendumRecipientTypeEnum, addendumStatusEnum, aiBidDocumentAnalysisStatusEnum, aiCoDraftStatusEnum, aiContractDocumentAnalysisStatusEnum, contractStatusEnum, contractTypeEnum, contractRedlineStatusEnum, contractApprovalDecisionEnum, clauseCategoryEnum, signatureRequestStatusEnum, signerStatusEnum, aiInsightModuleEnum, aiInsightSeverityEnum, aiTakeoffModeEnum, aiTakeoffStatusEnum, aiTakeoffSuggestionStatusEnum, aiTakeoffRejectReasonEnum, aiTaskPriorityEnum, aiTaskStatusEnum, approvalEntityTypeEnum, approvalStatusEnum, atsProviderEnum, bidEquipmentSourceEnum, bidInvitationStatusEnum, bidRequestStatusEnum, bidResponseStatusEnum, blogCommentStatusEnum, blogPostStatusEnum, conversationTypeEnum, crewAvailabilityStatusEnum, crmActivityTypeEnum, crmCallDirectionEnum, crmCallOutcomeEnum, crmCallStatusEnum, crmCustomFieldEntityEnum, crmCustomFieldTypeEnum, crmContactRoleEnum, crmNoteTypeEnum, crmOrgStatusEnum, crmOrganisationTypeEnum, crmPipelineStageEnum, crmPreferredContactEnum, crmLostCategoryEnum, crmQuoteAcceptanceStatusEnum, crmLeadScoringOperatorEnum, crmSequenceStatusEnum, crmSequenceStepTypeEnum, crmSequenceEnrollmentStatusEnum, crmSequenceExecutionStatusEnum, crmSequenceEmailEventTypeEnum, crmSequenceExitReasonEnum, crmQuoteApprovalStatusEnum, dataSubjectRequestStatusEnum, dataSubjectRequestTypeEnum, documentRevisionSourceEnum, documentRevisionStatusEnum, emailClassificationEnum, emailProviderEnum, emailTaskSourceEnum, emailThreadStatusEnum, hiringActivityTypeEnum, hiringCandidateStageEnum, hiringCompensationTypeEnum, hiringEmploymentTypeEnum, hiringInterviewStatusEnum, hiringJobStatusEnum, hiringSyncStatusEnum, hustlerDelegateRoleEnum, hustlerLinkRequestStatusEnum, installationStatusEnum, lidarScanStatusEnum, lidarAnnotationTypeEnum, lidarComparisonTypeEnum, unifiedPaymentMethodEnum, unifiedPaymentStatusEnum, invoiceTypeEnum, integrationConnectionStatusEnum, integrationEventStatusEnum, integrationProviderEnum, issueSeverityEnum, issueStatusEnum, jobsiteAnalysisStatusEnum, lienWaiverStatusEnum, lienWaiverTypeEnum, locationLevelEnum, maintenanceTypeEnum, measurementReviewStatusEnum, measurementSourceEnum, measurementStatusEnum, measurementTypeEnum, takeoffVersionStatusEnum, messageEntityTypeEnum, mobilePlatformEnum, offlineEntityTypeEnum, offlineOperationTypeEnum, offlineSyncStatusEnum, organizationDocumentTypeEnum, organizationDocumentVisibilityEnum, overheadCostActionEnum, overheadCostCategoryEnum, overheadCostFrequencyEnum, portalChatPriorityEnum, portalChatThreadCategoryEnum, portalChatThreadStatusEnum, pricebookImportJobStatusEnum, pricebookStatusEnum, pricingApprovalStatusEnum, pricingSourceTypeEnum, projectEquipmentPlanStatusEnum, repairStatusEnum, retentionActionEnum, retentionEntityTypeEnum, rewardTypeEnum, rfiCategoryEnum, rfiPriorityEnum, rfiStatusEnum, scheduleDependencyTypeEnum, scheduleGeneratedByEnum, scheduleTaskStatusEnum, socialAccountStatusEnum, socialPlatformEnum, socialPostStatusEnum, sovPaymentMethodEnum, sovStatusEnum, storedMaterialStatusEnum, retentionReleaseTypeEnum, retentionReleaseStatusEnum, sowAuditActionEnum, ssoProviderEnum, submittalCategoryEnum, submittalItemStatusEnum, submittalPhaseEnum, submittalReviewRoleEnum, submittalReviewStatusEnum, submittalStatusEnum, submittalTypeEnum, syncStatusEnum, tradeTypeEnum, transmittalStatusEnum, userRoleEnum, vendorEnrollmentStatusEnum, voiceLogStatusEnum, websiteDeploymentActionEnum, websitePageTypeEnum, websiteProjectStatusEnum, websiteStatusEnum, takeoffIssueCategoryEnum, takeoffIssueStatusEnum, talentAvailabilityEnum, talentProfileVisibilityEnum, workflowEntityTypeEnum, riskCategoryEnum, riskStatusEnum, workflowTemplateStatusEnum, workflowInstanceStatusEnum, videoCallStatusEnum, workflowNotificationChannelEnum, dotAgencyKindEnum, dotPayItemTypeEnum, dbeCertificationTypeEnum, suretyBondTypeEnum, suretyBondStatusEnum, haulTicketStatusEnum, swpppInspectionTypeEnum, idrStatusEnum, buyAmericaStatusEnum } from "../enums";
import { bids, organizations, projects, users } from "../core";
import { changeOrders, estimateLineItems, estimates, planDocuments, projectInspections, tasks, tmTickets } from "../operations";



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
  "INTEGRATION_SAGE",
  "INTEGRATION_BLUEBEAM",
  "INTEGRATION_AUTODESK",
  "PUBLIC_API",
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
  "TWILIO_INTEGRATION",
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
  // Task #1599: gates outbound emails to external architects/engineers
  // (no internal user account) when a submittal review is activated for
  // them or an RFI is forwarded to an external assignee. Default OFF so
  // existing tenants don't unexpectedly start emailing strangers.
  "EXTERNAL_DOC_EMAIL",
  // Task #2323 — when on, processAiTakeoff injects up to 5 recent EDITED
  // suggestions per trade (where qty delta >10%) as a "Recent corrections
  // from your team" block in the system prompt for the next AI takeoff
  // run for that org+trade. Default OFF so existing tenants don't pay
  // extra prompt tokens unexpectedly.
  "AI_TAKEOFF_FEW_SHOT",
  // Task #2324: AI Estimator workspace (takeoff drafting, estimate
  // generation, inline suggestions, chat, web research). Off by default;
  // org admins flip on per-org and then per-user.
  "AI_ESTIMATOR",
  // Task #2410: routes the Takeoff family of AI calls (aiTakeoffFeatureRoutes,
  // aiHeavyCivilFeatureRoutes, aiEstimator/takeoffDraft, aiEstimator/chat) to
  // Anthropic Claude when ON; OpenAI when OFF. Default OFF so existing tenants
  // keep their current GPT-5.2 behavior until a Super Admin flips them over.
  // New trial orgs can be flipped on at provisioning time.
  "AI_PROVIDER_TAKEOFF",
  // Task #2684: routes the non-Takeoff family of AI calls (executive digest,
  // project health, risk scoring, hiring, website/social copy, document analysis,
  // CRM, change-orders, and the rest) through the same OpenAI/Anthropic provider
  // router used by the Takeoff family. Default OFF — when OFF the router selects
  // OpenAI as the primary provider with no fallback, which is byte-for-byte
  // identical to the legacy direct-`openai.chat.completions.create` behavior.
  // When ON, eligible calls get Anthropic Claude primary with OpenAI automatic
  // fallback, exactly mirroring AI_PROVIDER_TAKEOFF for the General family.
  "AI_PROVIDER_GENERAL",
  // Task #2684: provider seam for embedding calls. Today every embedding call
  // resolves to OpenAI's `text-embedding-3-*` family because no other provider
  // is wired in (Anthropic does not ship a first-party embedding API as of this
  // writing). The flag exists so a future Voyage/Cohere/Bedrock provider can
  // be added without re-touching every call site. Default OFF preserves OpenAI.
  "AI_PROVIDER_EMBEDDINGS",
  // Task #2484 — when ON, COI compliance gating BLOCKS the release of
  // pay applications, purchase orders, and subcontractor payable
  // approvals when any project party is non-compliant (EXPIRED or
  // MISSING). When OFF, the gating is permissive (warn-only via the
  // dashboard / per-project endpoint). Audited overrides via
  // coi_compliance_overrides bypass the block either way. Default OFF
  // so tenants opt into the new enforcement.
  "COI_COMPLIANCE_HOLD",
] as const;

export type FeatureFlagKey = (typeof FEATURE_FLAG_KEYS)[number];

export const FEATURE_FLAG_LABELS: Record<FeatureFlagKey, string> = {
  INTEGRATIONS_HUB: "Integrations Hub",
  INTEGRATION_QBO: "QuickBooks Online",
  INTEGRATION_GOOGLE: "Google Workspace",
  INTEGRATION_MICROSOFT: "Microsoft 365",
  INTEGRATION_ESIGN: "E-Signature (DocuSign)",
  INTEGRATION_ZAPIER: "Zapier",
  INTEGRATION_SAGE: "Sage Intacct Construction",
  INTEGRATION_BLUEBEAM: "Bluebeam Studio",
  INTEGRATION_AUTODESK: "Autodesk Construction Cloud",
  PUBLIC_API: "Public API & Developer Portal",
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
  TWILIO_INTEGRATION: "Twilio Click-to-Call",
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
  EXTERNAL_DOC_EMAIL: "External Document Email Delivery",
  AI_TAKEOFF_FEW_SHOT: "AI Takeoff – Few-shot Corrections",
  AI_ESTIMATOR: "AI Estimator (takeoff, estimate, chat)",
  AI_PROVIDER_TAKEOFF: "AI Provider — Takeoff family on Claude",
  AI_PROVIDER_GENERAL: "AI Provider — General family on Claude",
  AI_PROVIDER_EMBEDDINGS: "AI Provider — Embeddings (reserved)",
  COI_COMPLIANCE_HOLD: "COI Compliance — Block release on non-compliance",
};

export const FEATURE_FLAG_DESCRIPTIONS: Record<FeatureFlagKey, string> = {
  INTEGRATIONS_HUB: "Central place to connect and monitor third-party services.",
  INTEGRATION_QBO: "Two-way sync of customers, invoices, bills, and payments with QuickBooks Online.",
  INTEGRATION_GOOGLE: "Connect Gmail and Google Calendar for messaging, scheduling, and email-to-task.",
  INTEGRATION_MICROSOFT: "Connect Outlook Mail and Calendar for messaging, scheduling, and email-to-task.",
  INTEGRATION_ESIGN: "Send contracts, change orders, and lien waivers through DocuSign for signature.",
  INTEGRATION_ZAPIER: "Trigger Zapier automations from project, bid, and CRM events.",
  INTEGRATION_SAGE: "Export job cost, AP, and AR to Sage Intacct Construction.",
  INTEGRATION_BLUEBEAM: "Round-trip drawings and markups with Bluebeam Studio Sessions.",
  INTEGRATION_AUTODESK: "Two-way sync of drawings, RFIs, and submittals with Autodesk Construction Cloud.",
  PUBLIC_API: "Issue API keys, manage webhook subscriptions, and access the developer portal.",
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
  TWILIO_INTEGRATION: "Click-to-call CRM contacts via Twilio with automatic call logging and recording.",
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
  EXTERNAL_DOC_EMAIL: "Send Resend emails to external architects/engineers for submittal reviews and forwarded RFIs, including a secure tokenized portal link.",
  AI_TAKEOFF_FEW_SHOT: "Inject up to five recent EDITED takeoff suggestions per trade into the next AI takeoff prompt as a 'Recent corrections' few-shot block.",
  AI_ESTIMATOR: "AI Estimator workspace: AI-drafted takeoffs, draft estimates, inline cost suggestions, an Ask the Estimator chat, and learning from your historical bids.",
  AI_PROVIDER_TAKEOFF: "Route the Takeoff/Heavy-Civil/AI-Estimator calls to Anthropic Claude instead of OpenAI GPT. Falls back to OpenAI automatically if Claude errors.",
  AI_PROVIDER_GENERAL: "Route the non-Takeoff AI calls (digest, health, risk, hiring, website/social copy, document analysis, CRM) through the provider router. When ON, primary is Anthropic Claude with OpenAI automatic fallback. When OFF, primary is OpenAI with no fallback (legacy behavior).",
  AI_PROVIDER_EMBEDDINGS: "Reserved provider seam for embedding calls. No alternative embedding provider is wired in today; flipping this on currently has no effect because every call site still resolves to OpenAI text-embedding-3-large.",
  COI_COMPLIANCE_HOLD: "Block pay-app, PO, and subcontractor payable approvals when project insurance compliance is EXPIRED or MISSING. Audited overrides bypass the hold. When OFF, the dashboard still shows non-compliance but releases are not blocked.",
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
  INTEGRATION_SAGE: "Integrations",
  INTEGRATION_BLUEBEAM: "Integrations",
  INTEGRATION_AUTODESK: "Integrations",
  PUBLIC_API: "Integrations",

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
  TWILIO_INTEGRATION: "Communications",

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
  EXTERNAL_DOC_EMAIL: "Core Platform",
  AI_TAKEOFF_FEW_SHOT: "Advanced Tech",
  AI_ESTIMATOR: "Advanced Tech",
  AI_PROVIDER_TAKEOFF: "Advanced Tech",
  AI_PROVIDER_GENERAL: "Advanced Tech",
  AI_PROVIDER_EMBEDDINGS: "Advanced Tech",
  COI_COMPLIANCE_HOLD: "Core Platform",
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
  "TWILIO_INTEGRATION",
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
  // Task #1599: external email branch is opt-in.
  "EXTERNAL_DOC_EMAIL",
  // Task #2323: few-shot prompt-injection of recent EDITED suggestions
  // is opt-in so existing tenants don't pay extra prompt tokens unexpectedly.
  "AI_TAKEOFF_FEW_SHOT",
  // Task #2324: AI Estimator is off by default; org admins enable per
  // org and then per user.
  "AI_ESTIMATOR",
  // Task #2410: Existing orgs stay on OpenAI GPT-5.2 until a Super Admin
  // explicitly flips them to Claude. Default-OFF preserves the current
  // behavior for every tenant on rollout day.
  "AI_PROVIDER_TAKEOFF",
  // Task #2684: Default OFF — when OFF the General router selects OpenAI as
  // primary with no fallback, byte-for-byte identical to legacy behavior.
  "AI_PROVIDER_GENERAL",
  // Task #2684: Default OFF — embedding provider seam is reserved; flipping
  // it has no observable effect today (only OpenAI provider is wired in).
  "AI_PROVIDER_EMBEDDINGS",
  // Task #2484: tenants opt into the new gating after they have
  // backfilled certs / project requirements.
  "COI_COMPLIANCE_HOLD",
] as const;

// Task #1119: audit log of trade-preset applications on the Feature Flags tab.
// Each row records who applied which trade preset to an organization and when,
// so admins can see "Last applied: <Trade Preset> on <date> by <user>".
//
// Task #1314: extended with `kind` ("apply" for full preset applications,
// "reset_drift" for per-flag or bulk drift-reset actions) and `flag_keys`
// (the affected flag keys for reset rows). The Preset history card surfaces
// reset entries inline alongside full applications, distinguished by an icon
// and the affected flag keys.
export const featureFlagPresetApplications = pgTable("feature_flag_preset_applications", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  tradeType: text("trade_type").notNull(),
  appliedById: varchar("applied_by_id").references(() => users.id, { onDelete: "set null" }),
  appliedAt: timestamp("applied_at").notNull().defaultNow(),
  kind: text("kind").notNull().default("apply"),
  flagKeys: text("flag_keys").array(),
}, (t) => ({
  orgAppliedAtIdx: index("ffpa_org_applied_at_idx").on(t.organizationId, t.appliedAt),
}));
export const insertFeatureFlagPresetApplicationSchema = createInsertSchema(featureFlagPresetApplications).omit({ id: true, appliedAt: true });
export type InsertFeatureFlagPresetApplication = z.infer<typeof insertFeatureFlagPresetApplicationSchema>;
export type FeatureFlagPresetApplication = typeof featureFlagPresetApplications.$inferSelect;

// Task #1290: audit log of individual feature-flag flips made via the
// per-flag toggle (outside of trade preset application). Surfaces a "Manual
// flag changes" list on the Feature Flags tab so support engineers can see
// who flipped which flag, when, and from what value.
export const featureFlagManualChanges = pgTable("feature_flag_manual_changes", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  flagKey: text("flag_key").notNull(),
  previousValue: boolean("previous_value").notNull(),
  newValue: boolean("new_value").notNull(),
  changedById: varchar("changed_by_id").references(() => users.id, { onDelete: "set null" }),
  changedAt: timestamp("changed_at").notNull().defaultNow(),
}, (t) => ({
  orgChangedAtIdx: index("ffmc_org_changed_at_idx").on(t.organizationId, t.changedAt),
}));
export const insertFeatureFlagManualChangeSchema = createInsertSchema(featureFlagManualChanges).omit({ id: true, changedAt: true });
export type InsertFeatureFlagManualChange = z.infer<typeof insertFeatureFlagManualChangeSchema>;
export type FeatureFlagManualChange = typeof featureFlagManualChanges.$inferSelect;