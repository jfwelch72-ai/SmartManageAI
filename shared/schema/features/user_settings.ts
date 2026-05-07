// AUTO-GENERATED SPLIT FROM shared/schema/features.ts (Task #2426).
// Domain bucketing rule lives in shared/schema/features/index.ts.
import { sql } from "drizzle-orm";
import { pgTable, text, varchar, boolean, timestamp, date, decimal, integer, pgEnum, doublePrecision, index, unique, uniqueIndex, json, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod";
import { addendumRecipientTypeEnum, addendumStatusEnum, aiBidDocumentAnalysisStatusEnum, aiCoDraftStatusEnum, aiContractDocumentAnalysisStatusEnum, contractStatusEnum, contractTypeEnum, contractRedlineStatusEnum, contractApprovalDecisionEnum, clauseCategoryEnum, signatureRequestStatusEnum, signerStatusEnum, aiInsightModuleEnum, aiInsightSeverityEnum, aiTakeoffModeEnum, aiTakeoffStatusEnum, aiTakeoffSuggestionStatusEnum, aiTakeoffRejectReasonEnum, aiTaskPriorityEnum, aiTaskStatusEnum, approvalEntityTypeEnum, approvalStatusEnum, atsProviderEnum, bidEquipmentSourceEnum, bidInvitationStatusEnum, bidRequestStatusEnum, bidResponseStatusEnum, blogCommentStatusEnum, blogPostStatusEnum, conversationTypeEnum, crewAvailabilityStatusEnum, crmActivityTypeEnum, crmCallDirectionEnum, crmCallOutcomeEnum, crmCallStatusEnum, crmCustomFieldEntityEnum, crmCustomFieldTypeEnum, crmContactRoleEnum, crmNoteTypeEnum, crmOrgStatusEnum, crmOrganisationTypeEnum, crmPipelineStageEnum, crmPreferredContactEnum, crmLostCategoryEnum, crmQuoteAcceptanceStatusEnum, crmLeadScoringOperatorEnum, crmSequenceStatusEnum, crmSequenceStepTypeEnum, crmSequenceEnrollmentStatusEnum, crmSequenceExecutionStatusEnum, crmSequenceEmailEventTypeEnum, crmSequenceExitReasonEnum, crmQuoteApprovalStatusEnum, dataSubjectRequestStatusEnum, dataSubjectRequestTypeEnum, documentRevisionSourceEnum, documentRevisionStatusEnum, emailClassificationEnum, emailProviderEnum, emailTaskSourceEnum, emailThreadStatusEnum, hiringActivityTypeEnum, hiringCandidateStageEnum, hiringCompensationTypeEnum, hiringEmploymentTypeEnum, hiringInterviewStatusEnum, hiringJobStatusEnum, hiringSyncStatusEnum, hustlerDelegateRoleEnum, hustlerLinkRequestStatusEnum, installationStatusEnum, lidarScanStatusEnum, lidarAnnotationTypeEnum, lidarComparisonTypeEnum, unifiedPaymentMethodEnum, unifiedPaymentStatusEnum, invoiceTypeEnum, integrationConnectionStatusEnum, integrationEventStatusEnum, integrationProviderEnum, issueSeverityEnum, issueStatusEnum, jobsiteAnalysisStatusEnum, lienWaiverStatusEnum, lienWaiverTypeEnum, locationLevelEnum, maintenanceTypeEnum, measurementReviewStatusEnum, measurementSourceEnum, measurementStatusEnum, measurementTypeEnum, takeoffVersionStatusEnum, messageEntityTypeEnum, mobilePlatformEnum, offlineEntityTypeEnum, offlineOperationTypeEnum, offlineSyncStatusEnum, organizationDocumentTypeEnum, organizationDocumentVisibilityEnum, overheadCostActionEnum, overheadCostCategoryEnum, overheadCostFrequencyEnum, portalChatPriorityEnum, portalChatThreadCategoryEnum, portalChatThreadStatusEnum, pricebookImportJobStatusEnum, pricebookStatusEnum, pricingApprovalStatusEnum, pricingSourceTypeEnum, projectEquipmentPlanStatusEnum, repairStatusEnum, retentionActionEnum, retentionEntityTypeEnum, rewardTypeEnum, rfiCategoryEnum, rfiPriorityEnum, rfiStatusEnum, scheduleDependencyTypeEnum, scheduleGeneratedByEnum, scheduleTaskStatusEnum, socialAccountStatusEnum, socialPlatformEnum, socialPostStatusEnum, sovPaymentMethodEnum, sovStatusEnum, storedMaterialStatusEnum, retentionReleaseTypeEnum, retentionReleaseStatusEnum, sowAuditActionEnum, ssoProviderEnum, submittalCategoryEnum, submittalItemStatusEnum, submittalPhaseEnum, submittalReviewRoleEnum, submittalReviewStatusEnum, submittalStatusEnum, submittalTypeEnum, syncStatusEnum, tradeTypeEnum, transmittalStatusEnum, userRoleEnum, vendorEnrollmentStatusEnum, voiceLogStatusEnum, websiteDeploymentActionEnum, websitePageTypeEnum, websiteProjectStatusEnum, websiteStatusEnum, takeoffIssueCategoryEnum, takeoffIssueStatusEnum, talentAvailabilityEnum, talentProfileVisibilityEnum, workflowEntityTypeEnum, riskCategoryEnum, riskStatusEnum, workflowTemplateStatusEnum, workflowInstanceStatusEnum, videoCallStatusEnum, workflowNotificationChannelEnum, dotAgencyKindEnum, dotPayItemTypeEnum, dbeCertificationTypeEnum, suretyBondTypeEnum, suretyBondStatusEnum, haulTicketStatusEnum, swpppInspectionTypeEnum, idrStatusEnum, buyAmericaStatusEnum } from "../enums";
import { bids, organizations, projects, users } from "../core";
import { changeOrders, estimateLineItems, estimates, planDocuments, projectInspections, tasks, tmTickets } from "../operations";



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
  canManageProjectTemplates: boolean("can_manage_project_templates").default(false),
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
  // Task #886: gate CRM email-thread viewing (logged Gmail/Outlook messages)
  canViewCrmEmails: boolean("can_view_crm_emails").default(false),
  // Task #890: gate CRM call logging (manual logs + Twilio click-to-call)
  canLogCrmCalls: boolean("can_log_crm_calls").default(false),

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
  // Task #2324: AI Estimator workspace per-user gates. canUseAiEstimator
  // grants access to the takeoff drafting / estimate generation / chat
  // surfaces; canManageAiEstimator gates the admin enablement page and
  // manual re-ingest button.
  canUseAiEstimator: boolean("can_use_ai_estimator").default(false),
  canManageAiEstimator: boolean("can_manage_ai_estimator").default(false),

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
  config?: Record<string, unknown>;
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
  // Task #696: per-user opt-out for the weekly CRM contact birthday digest.
  // Defaults to false (opted in) so existing recipients keep receiving the
  // digest until they explicitly silence it from notification preferences.
  crmBirthdayDigestOptOut: boolean("crm_birthday_digest_opt_out").notNull().default(false),
  birthdayDigestWeekday: integer("birthday_digest_weekday").notNull().default(1),
  birthdayDigestHour: integer("birthday_digest_hour").notNull().default(8),
  // Task #2142 — Mobile / stylus precision pass for takeoff. Three
  // per-user knobs that govern palm rejection, the stylus long-press
  // snap-HUD threshold, and whether two-finger rotate is honored on
  // touch devices. Defaults match Section 7 of the Takeoff Interaction
  // Map: rotate stays off, palm band 24px, long-press 500ms.
  allowTwoFingerRotate: boolean("allow_two_finger_rotate").notNull().default(false),
  palmRejectionBandPx: integer("palm_rejection_band_px").notNull().default(24),
  stylusLongPressMs: integer("stylus_long_press_ms").notNull().default(500),
  // Task #2228 — "Don't ask again" toggle inside the bulk-scale
  // propagation confirmation dialog. When true, hitting Save with
  // the Apply-to-Sheet-Set checkbox checked on a >5-member set
  // skips the AlertDialog and propagates immediately (the toast
  // Undo affordance is still the safety net). Default is false so
  // every user sees the dialog at least once.
  skipBulkScalePropagationConfirm: boolean("skip_bulk_scale_propagation_confirm").notNull().default(false),
  // Task #2570 — Remember the user's preferred barcode/QR label sheet
  // template for the Inventory → Labels tab. Default keeps prior behavior
  // (Avery 5160, 3×10 on US Letter).
  labelSheetTemplate: text("label_sheet_template").notNull().default("avery_5160"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  userIdx: index("user_settings_user_idx").on(table.userId),
}));

export const TABLE_DENSITY_VALUES = ["COMPACT", "COZY", "COMFORTABLE"] as const;
export type TableDensity = (typeof TABLE_DENSITY_VALUES)[number];

export const BIRTHDAY_DIGEST_DEFAULT_WEEKDAY = 1;
export const BIRTHDAY_DIGEST_DEFAULT_HOUR = 8;

// Task #2142 — Defaults + clamps for the takeoff stylus prefs. Kept in
// shared/schema so both the PATCH zod and the client form stay in sync.
export const DEFAULT_ALLOW_TWO_FINGER_ROTATE = false;
export const DEFAULT_PALM_REJECTION_BAND_PX = 24;
export const PALM_REJECTION_BAND_MIN_PX = 0;
export const PALM_REJECTION_BAND_MAX_PX = 96;
export const DEFAULT_STYLUS_LONG_PRESS_MS = 500;
export const STYLUS_LONG_PRESS_MIN_MS = 250;
export const STYLUS_LONG_PRESS_MAX_MS = 1500;

// Task #2228 — Member-count threshold above which the bulk scale
// propagation confirmation AlertDialog appears. Single-member /
// small sets (<= threshold) keep the one-click path; only sets
// large enough to make an accidental propagation expensive get the
// extra confirmation step. Lives in the shared schema so both the
// drawer and any future server-side guard can reference the same
// number.
export const BULK_SCALE_PROPAGATION_CONFIRM_MIN_MEMBERS = 5;
export const DEFAULT_SKIP_BULK_SCALE_PROPAGATION_CONFIRM = false;

// Task #2570 — Library of barcode/QR label-sheet templates that the
// Inventory → Labels tab can lay out against, plus the default the
// server falls back to when nothing is set on `userSettings` yet.
//
// All dimensions are in inches; the server converts to PDF points
// (×72) at render time. Page sizes accept the values supported by
// PDFKit ("LETTER", "A4", or `[width, height]` in points).
//
// `pageSize: "LETTER"` is the standard 8.5" × 11" sheet. `[w, h]`
// in inches is converted at render time for the 4×6 thermal roll.
export type LabelSheetTemplate = {
  id: string;
  label: string;
  description: string;
  pageSize: "LETTER" | "A4" | { widthIn: number; heightIn: number };
  cols: number;
  rows: number;
  labelWidthIn: number;
  labelHeightIn: number;
  marginTopIn: number;
  marginLeftIn: number;
  horizontalPitchIn: number;
  verticalPitchIn: number;
};

export const LABEL_SHEET_TEMPLATES: readonly LabelSheetTemplate[] = [
  {
    id: "avery_5160",
    label: "Avery 5160 (3 × 10)",
    description: "1\" × 2.625\" address labels, 30 per US Letter sheet.",
    pageSize: "LETTER",
    cols: 3,
    rows: 10,
    labelWidthIn: 2.625,
    labelHeightIn: 1,
    marginTopIn: 0.5,
    marginLeftIn: 0.1875,
    horizontalPitchIn: 2.75,
    verticalPitchIn: 1,
  },
  {
    id: "avery_5163",
    label: "Avery 5163 (2 × 5)",
    description: "2\" × 4\" shipping labels, 10 per US Letter sheet.",
    pageSize: "LETTER",
    cols: 2,
    rows: 5,
    labelWidthIn: 4,
    labelHeightIn: 2,
    marginTopIn: 0.5,
    marginLeftIn: 0.15625,
    horizontalPitchIn: 4.1875,
    verticalPitchIn: 2,
  },
  {
    id: "avery_5167",
    label: "Avery 5167 (4 × 20)",
    description: "0.5\" × 1.75\" return address labels, 80 per US Letter sheet.",
    pageSize: "LETTER",
    cols: 4,
    rows: 20,
    labelWidthIn: 1.75,
    labelHeightIn: 0.5,
    marginTopIn: 0.5,
    marginLeftIn: 0.3,
    horizontalPitchIn: 2.0625,
    verticalPitchIn: 0.5,
  },
  {
    id: "avery_5267",
    label: "Avery 5267 (4 × 20)",
    description: "0.5\" × 1.75\" return address labels (laser), 80 per sheet.",
    pageSize: "LETTER",
    cols: 4,
    rows: 20,
    labelWidthIn: 1.75,
    labelHeightIn: 0.5,
    marginTopIn: 0.5,
    marginLeftIn: 0.3,
    horizontalPitchIn: 2.0625,
    verticalPitchIn: 0.5,
  },
  {
    id: "thermal_4x6",
    label: "Thermal 4\" × 6\"",
    description: "Single-label 4\" × 6\" thermal roll (Zebra/DYMO).",
    pageSize: { widthIn: 4, heightIn: 6 },
    cols: 1,
    rows: 1,
    labelWidthIn: 4,
    labelHeightIn: 6,
    marginTopIn: 0,
    marginLeftIn: 0,
    horizontalPitchIn: 4,
    verticalPitchIn: 6,
  },
] as const;

export const LABEL_SHEET_TEMPLATE_IDS = LABEL_SHEET_TEMPLATES.map((t) => t.id) as [string, ...string[]];
export const DEFAULT_LABEL_SHEET_TEMPLATE = "avery_5160";

export function getLabelSheetTemplate(id: string | null | undefined): LabelSheetTemplate {
  return LABEL_SHEET_TEMPLATES.find((t) => t.id === id) ?? LABEL_SHEET_TEMPLATES[0];
}

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
  isShared: boolean("is_shared").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  userViewKeyIdx: index("user_saved_views_user_view_key_idx").on(table.userId, table.viewKey),
  orgSharedViewKeyIdx: index("user_saved_views_org_shared_view_key_idx").on(table.organizationId, table.isShared, table.viewKey),
}));

export const insertUserSavedViewSchema = createInsertSchema(userSavedViews).omit({ id: true, createdAt: true });
export type InsertUserSavedView = z.infer<typeof insertUserSavedViewSchema>;
export type UserSavedView = typeof userSavedViews.$inferSelect;

// Task #898: My Work Saved Views — dedicated per-user table for the My Work page.
// Kept separate from `userSavedViews` so we can add My-Work-specific options
// later (e.g. default grouping, "show team work") without polluting the shared
// org-wide saved-views schema.
export const myWorkSavedViews = pgTable("my_work_saved_views", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  view: text("view").notNull(),
  filtersJson: text("filters_json").notNull().default("{}"),
  // Per-view default grouping (e.g. "none" | "project" | "status" | "due-week").
  // Nullable so older rows that pre-date the column simply fall back to the
  // user's last-used grouping when the view is applied.
  grouping: text("grouping"),
  isShared: boolean("is_shared").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  userIdx: index("my_work_saved_views_user_idx").on(table.userId),
  orgSharedIdx: index("my_work_saved_views_org_shared_idx").on(table.organizationId, table.isShared),
}));

export const insertMyWorkSavedViewSchema = createInsertSchema(myWorkSavedViews).omit({ id: true, createdAt: true });
export type InsertMyWorkSavedView = z.infer<typeof insertMyWorkSavedViewSchema>;
export type MyWorkSavedView = typeof myWorkSavedViews.$inferSelect;

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